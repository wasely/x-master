import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getChromaSettings, getChromaStartCommand, getTweetExamplesCollection, getTweetRejectionsCollection } from "@/lib/chroma";
import { LengthId, ToneId, getLengthOption, getToneOption, wordCount } from "@/lib/content-options";
import {
  TweetMetadata,
  buildTweetMetadata,
  matchesTweetFilter,
  toTweetRecord,
} from "@/lib/tweets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

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

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

function jsonError(message: string, status: number, details?: unknown) {
  return json(
    {
      error: message,
      details: details instanceof Error ? details.message : details,
      startCommand: getChromaStartCommand(),
      settings: getChromaSettings(),
    },
    status,
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

function normalizeAuthorHandle(value: unknown) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/^@/, "");
  return /^[a-zA-Z0-9_]{1,15}$/.test(clean) ? clean : undefined;
}

function extractAuthorHandleFromUrl(url?: string) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const [handle, segment] = parsed.pathname.split("/").filter(Boolean);
    if (!handle || (segment && segment !== "status")) return undefined;
    return normalizeAuthorHandle(handle);
  } catch {
    return undefined;
  }
}

function cleanTweetTextForStorage(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")  // URLs
    .replace(/@\w+/g, "")             // @mentions
    .replace(/#\w+/g, "")             // #hashtags
    .replace(/[ \t]{2,}/g, " ")       // collapsed spaces
    .replace(/\n{3,}/g, "\n\n")       // collapsed blank lines
    .trim();
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
    author_url?: string;
    url?: string;
  };

  const tweetParagraph = data.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const text = tweetParagraph ? htmlToText(tweetParagraph) : "";

  if (!text) return null;

  return {
    text,
    authorName: data.author_name,
    authorHandle: extractAuthorHandleFromUrl(data.author_url ?? data.url ?? url),
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
  const outlineStyleSections = text.match(/(?:^|\n)\s*(?:[ivx]+\.)/gim)?.length ?? 0;

  if (numberedSections >= 3 || outlineStyleSections >= 3) return "thread";
  if (count <= 12) return "one_liner";
  if (count <= 30) return "short_post";
  if (count <= 90) return "regular_post";
  if (count <= 320) return "thread";
  return "article";
}

function inferTone(text: string): ToneId {
  const clean = text.toLowerCase();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lowerCaseRatio = words.length
    ? words.filter((word) => word === word.toLowerCase()).length / words.length
    : 0;

  if (/\b(lol|lmao|haha|hilarious|funny|absurd|ridiculous)\b/.test(clean)) return "funny";
  if (
    lowerCaseRatio > 0.9 &&
    /\b(yo|nah|bro|crazy|gonna|gotta|wanna|kinda|idk|btw|tbh|u)\b/.test(clean)
  ) {
    return "just_typing";
  }
  if (
    /\b(chill|calm|gentle|slow|easy|soft|quiet|breathe|steady|peaceful|cozy)\b/.test(clean)
  ) {
    return "relax";
  }
  if (
    /\b(i think|i feel|maybe|probably|usually|sometimes|reminder|understand|notice)\b/.test(clean) ||
    /\b(how to|guide|walkthrough|playbook|framework|step|lesson|explained|breakdown|here'?s why|let'?s go through)\b/.test(clean)
  ) {
    return "calm";
  }

  return "persuasive";
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
  const useRejections = searchParams.get("collection") === "rejections";

  try {
    const collection = useRejections
      ? await getTweetRejectionsCollection()
      : await getTweetExamplesCollection();

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

      return json({ examples, query, filter });
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

    return json({ examples, query: "", filter });
  } catch (error) {
    return jsonError("Could not read tweet examples from the vector database.", 503, error);
  }
}

export async function POST(request: Request) {
  let body: {
    input?: string;
    notes?: string;
    tweetText?: string;
    authorName?: unknown;
    authorHandle?: unknown;
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
  const requestedAuthorName =
    typeof body.authorName === "string" ? body.authorName.trim().replace(/^@/, "") : "";
  const requestedAuthorHandle = normalizeAuthorHandle(body.authorHandle);

  if (!input) {
    return jsonError("Paste a tweet URL or tweet text first.", 400);
  }

  const url = firstUrl(input);
  const tweetId = url ? extractTweetId(url) : undefined;
  const rawTweetText = body.tweetText?.trim() || "";
  // If the scraped text is just a bare URL (e.g. a t.co link), discard it and let oEmbed fetch the real text
  let tweetText = /^https?:\/\/\S+$/.test(rawTweetText) ? "" : rawTweetText;
  let authorName: string | undefined = requestedAuthorName || undefined;
  let authorHandle: string | undefined = requestedAuthorHandle;
  let sourceUrl = url;

  if (!tweetText && url) {
    const oembedTweet = await fetchTweetTextFromOembed(url);
    tweetText = oembedTweet?.text ?? "";
    authorName = authorName ?? oembedTweet?.authorName;
    authorHandle = authorHandle ?? oembedTweet?.authorHandle;
    sourceUrl = oembedTweet?.sourceUrl ?? url;
  }

  authorHandle = authorHandle ?? extractAuthorHandleFromUrl(sourceUrl);

  if (!tweetText) {
    tweetText = url ? input.replace(url, "").trim() : input;
  }

  tweetText = cleanTweetTextForStorage(tweetText);

  if (tweetText.split(/\s+/).filter(Boolean).length < 4) {
    return jsonError("Tweet is too short to be a useful style example.", 422);
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
  const tone =
    typeof body.tone === "string" && body.tone.trim()
      ? getToneOption(body.tone).id
      : inferred.tone;
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : inferred.category;
  const length =
    typeof body.length === "string" && body.length.trim()
      ? getLengthOption(body.length).id
      : inferred.length;
  const id = tweetId ? `x-${tweetId}` : `manual-${hashId(`${sourceUrl ?? ""}:${tweetText}`)}`;
  const metadata = buildTweetMetadata({
    sourceType: sourceUrl ? "tweet_url" : "manual",
    createdAt,
    sourceUrl,
    tweetId,
    authorName,
    authorHandle,
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

    return json({ example: toTweetRecord(id, tweetText, metadata) });
  } catch (error) {
    return jsonError("Could not save tweet example to the vector database.", 503, error);
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const useRejections = searchParams.get("collection") === "rejections";

  if (!id) {
    return jsonError("Missing tweet example id.", 400);
  }

  try {
    const collection = useRejections
      ? await getTweetRejectionsCollection()
      : await getTweetExamplesCollection();
    await collection.delete({ ids: [id] });
    return json({ ok: true });
  } catch (error) {
    return jsonError("Could not delete from the vector database.", 503, error);
  }
}
