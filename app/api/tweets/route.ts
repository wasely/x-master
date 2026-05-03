import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getChromaSettings, getChromaStartCommand, getTweetExamplesCollection } from "@/lib/chroma";
import { LengthId, ToneId, wordCount } from "@/lib/content-options";
import {
  TweetMetadata,
  buildTweetMetadata,
  matchesTweetFilter,
  toTweetRecord,
} from "@/lib/tweets";

export const runtime = "nodejs";

type InferredMetadata = {
  tags: string[];
  tone: ToneId;
  category: string;
  length: LengthId;
};

function parseLimit(value: string | null, fallback = 25) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.max(1, Math.min(Math.trunc(parsed), 50));
}

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      details: details instanceof Error ? details.message : details,
      startCommand: getChromaStartCommand(),
      settings: getChromaSettings(),
    },
    { status },
  );
}

function hashId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 18);
}

function firstUrl(value: string) {
  return value.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.]+$/, "");
}

function extractTweetId(url: string) {
  return url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status(?:es)?\/(\d+)/i)?.[1];
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

async function fetchTweetTextFromOembed(url: string) {
  const response = await fetch(
    `https://publish.twitter.com/oembed?omit_script=1&hide_thread=1&url=${encodeURIComponent(url)}`,
    { cache: "no-store" },
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    html?: string;
    author_name?: string;
    url?: string;
  };

  const tweetParagraph = data.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const text = tweetParagraph ? htmlToText(tweetParagraph) : "";

  if (!text) return null;

  return {
    text,
    authorName: data.author_name,
    sourceUrl: data.url ?? url,
  };
}

function parseTags(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function uniqueCleanTags(tags: string[]) {
  const seen = new Set<string>();

  return tags
    .map((tag) =>
      tag
        .toLowerCase()
        .replace(/^#/, "")
        .replace(/[^a-z0-9 +.-]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((tag) => {
      if (!tag || tag.length < 2 || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 6);
}

function inferLength(text: string): LengthId {
  const count = wordCount(text);
  const numberedSections = text.match(/(?:^|\n)\s*\d+\//g)?.length ?? 0;

  if (numberedSections >= 3) return "thread";
  if (count <= 15) return "short";
  if (count <= 30) return "medium";
  if (count <= 75) return "long";
  if (count <= 300) return "thread";
  if (count <= 1000) return "article";
  return "manifesto";
}

function inferTone(text: string): ToneId {
  const clean = text.toLowerCase();

  if (/\b(lol|lmao|haha|hilarious|funny|absurd|ridiculous)\b/.test(clean)) return "funny";
  if (/\b(unpopular opinion|hot take|most people are wrong|everyone gets this wrong|contrarian)\b/.test(clean)) {
    return "contrarian";
  }
  if (/\b(how to|guide|framework|lesson|mistake|step|playbook|principle|here'?s why)\b/.test(clean)) {
    return "educational";
  }
  if (/\b(keep going|you can|discipline|mindset|believe|dream|motivation|win)\b/.test(clean)) {
    return "motivational";
  }
  if (/\b(risk|cost|problem|crisis|warning|serious|truth|reality)\b/.test(clean)) return "serious";
  return "impactful";
}

function inferCategoryAndTags(text: string, notes: string) {
  const clean = `${text} ${notes}`.toLowerCase();
  const topicChecks: { category: string; tags: string[]; pattern: RegExp }[] = [
    { category: "ai", tags: ["ai", "automation", "tools"], pattern: /\b(ai|llm|gpt|agent|automation|model|prompt)\b/ },
    { category: "startup", tags: ["startup", "founder", "growth"], pattern: /\b(startup|founder|fundraising|vc|runway|mvp)\b/ },
    { category: "marketing", tags: ["marketing", "positioning", "growth"], pattern: /\b(marketing|brand|positioning|copywriting|funnel|audience)\b/ },
    { category: "product", tags: ["product", "ux", "strategy"], pattern: /\b(product|feature|roadmap|ux|user|design|launch)\b/ },
    { category: "software", tags: ["software", "engineering", "dev"], pattern: /\b(code|developer|engineering|bug|api|typescript|javascript|react|database)\b/ },
    { category: "business", tags: ["business", "strategy", "sales"], pattern: /\b(business|sales|revenue|customer|pricing|deal|offer)\b/ },
    { category: "creator", tags: ["creator", "content", "audience"], pattern: /\b(creator|content|thread|tweet|post|followers|community)\b/ },
    { category: "personal growth", tags: ["mindset", "discipline", "habits"], pattern: /\b(habit|discipline|mindset|focus|productivity|learning)\b/ },
  ];

  const matched = topicChecks.find((topic) => topic.pattern.test(clean));
  const hashtags = Array.from(clean.matchAll(/#([a-z0-9_]+)/g)).map((match) => match[1]);
  const category = matched?.category ?? "general";
  const tags = uniqueCleanTags([
    ...hashtags,
    ...(matched?.tags ?? []),
    ...Array.from(clean.matchAll(/\b[a-z][a-z0-9+-]{4,}\b/g))
      .map((match) => match[0])
      .filter((word) => !["about", "their", "there", "would", "could", "should", "because"].includes(word)),
  ]);

  return {
    category,
    tags: tags.length ? tags : ["x-writing", category],
  };
}

function fallbackMetadata(tweetText: string, notes: string): InferredMetadata {
  const inferred = inferCategoryAndTags(tweetText, notes);

  return {
    length: inferLength(tweetText),
    tone: inferTone(tweetText),
    category: inferred.category,
    tags: inferred.tags,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() ?? "";
  const filter = searchParams.get("filter")?.trim() ?? searchParams.get("tag")?.trim() ?? "";
  const limit = parseLimit(searchParams.get("limit"));

  try {
    const collection = await getTweetExamplesCollection();

    if (query) {
      const results = await collection.query<TweetMetadata>({
        queryTexts: [query],
        nResults: limit,
        include: ["documents", "metadatas", "distances"],
      });

      let examples =
        results.ids[0]?.map((id, index) =>
          toTweetRecord(
            id,
            results.documents?.[0]?.[index] ?? null,
            results.metadatas?.[0]?.[index] ?? null,
            results.distances?.[0]?.[index] ?? undefined,
          ),
        ) ?? [];

      if (filter) {
        examples = examples.filter((example) => matchesTweetFilter(example, filter));
      }

      return NextResponse.json({ examples, query, filter });
    }

    const results = await collection.get<TweetMetadata>({
      limit,
      include: ["documents", "metadatas"],
    });

    let examples = results.ids.map((id, index) =>
      toTweetRecord(id, results.documents?.[index] ?? null, results.metadatas?.[index] ?? null),
    );

    examples.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

    if (filter) {
      examples = examples.filter((example) => matchesTweetFilter(example, filter));
    }

    return NextResponse.json({ examples, query: "", filter });
  } catch (error) {
    return jsonError("Could not read tweet examples from Chroma.", 503, error);
  }
}

export async function POST(request: Request) {
  let body: {
    input?: string;
    notes?: string;
    tweetText?: string;
    tags?: unknown;
    tone?: unknown;
    category?: unknown;
    length?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const input = body.input?.trim();
  const notes = body.notes?.trim();

  if (!input) {
    return jsonError("Paste a tweet URL or tweet text first.", 400);
  }

  const url = firstUrl(input);
  const tweetId = url ? extractTweetId(url) : undefined;
  let tweetText = body.tweetText?.trim() || "";
  let authorName: string | undefined;
  let sourceUrl = url;

  if (!tweetText && url) {
    const oembedTweet = await fetchTweetTextFromOembed(url);
    tweetText = oembedTweet?.text ?? "";
    authorName = oembedTweet?.authorName;
    sourceUrl = oembedTweet?.sourceUrl ?? url;
  }

  if (!tweetText) {
    tweetText = url ? input.replace(url, "").trim() : input;
  }

  if (!tweetText) {
    return jsonError(
      "I found the tweet link, but could not read the tweet text. Paste the tweet text with the link and save again.",
      422,
    );
  }

  const createdAt = new Date().toISOString();
  const inferred = fallbackMetadata(tweetText, notes ?? "");
  const tags = parseTags(body.tags);
  const tone = typeof body.tone === "string" && body.tone.trim() ? body.tone.trim() : inferred.tone;
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : inferred.category;
  const length = typeof body.length === "string" && body.length.trim() ? body.length.trim() : inferred.length;
  const id = tweetId ? `x-${tweetId}` : `manual-${hashId(`${sourceUrl ?? ""}:${tweetText}`)}`;
  const metadata = buildTweetMetadata({
    sourceType: sourceUrl ? "tweet_url" : "manual",
    createdAt,
    sourceUrl,
    tweetId,
    authorName,
    notes,
    tags: tags.length ? tags : inferred.tags,
    tone,
    category,
    length,
  });

  try {
    const collection = await getTweetExamplesCollection();
    await collection.upsert({
      ids: [id],
      documents: [tweetText],
      metadatas: [metadata],
      uris: sourceUrl ? [sourceUrl] : undefined,
    });

    return NextResponse.json({
      example: toTweetRecord(id, tweetText, metadata),
    });
  } catch (error) {
    return jsonError("Could not save tweet example to Chroma.", 503, error);
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return jsonError("Missing tweet example id.", 400);
  }

  try {
    const collection = await getTweetExamplesCollection();
    await collection.delete({ ids: [id] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError("Could not delete tweet example from Chroma.", 503, error);
  }
}
