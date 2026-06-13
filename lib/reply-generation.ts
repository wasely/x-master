import { getTweetExamplesCollection, getTweetRejectionsCollection } from "@/lib/chroma";
import { getLengthOption, getToneOption, LengthId, ToneId } from "@/lib/content-options";
import { TweetMetadata, normalizeTags } from "@/lib/tweets";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type StyleReference = {
  text: string;
  notes?: string;
  tags: string[];
  tone?: string;
  category?: string;
  length?: string;
  distance?: number;
};

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export type GenerateReplyInput = {
  tweetText: string;
  tweetUrl?: string;
  authorName?: string;
  authorHandle?: string;
  toneId: ToneId;
  lengthId: LengthId;
};

function cleanText(value: string) {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function normalizeGeneratedReply(value: string) {
  let output = cleanText(value)
    .replace(/^```[\w-]*\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(reply|response|tweet|post)\s*:\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (
    output.length >= 2 &&
    ((output.startsWith('"') && output.endsWith('"')) ||
      (output.startsWith("'") && output.endsWith("'")))
  ) {
    output = output.slice(1, -1).trim();
  }

  return output;
}

function extractCompletionText(data: any) {
  const message = data?.choices?.[0]?.message;
  const rawContent = message?.content ?? data?.output_text ?? data?.choices?.[0]?.text;

  if (Array.isArray(rawContent)) {
    return normalizeGeneratedReply(
      rawContent
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            if (typeof part.text === "string") return part.text;
            if (typeof part.content === "string") return part.content;
          }
          return "";
        })
        .join(" "),
    );
  }

  if (typeof rawContent === "string") {
    return normalizeGeneratedReply(rawContent);
  }

  return "";
}

function isFilteredResponse(data: any) {
  const finishReason = data?.choices?.[0]?.finish_reason;
  const nativeFinishReason = data?.choices?.[0]?.native_finish_reason;

  return (
    finishReason === "content_filter" ||
    String(nativeFinishReason ?? "").toUpperCase().includes("SAFETY") ||
    String(nativeFinishReason ?? "").toUpperCase().includes("FILTER")
  );
}

function maxTokensForWords(maxWords: number) {
  return Math.min(Math.max(Math.ceil(maxWords * 2.2), 180), 1200);
}

function lengthFamily(lengthId?: string) {
  switch (lengthId) {
    case "article":
      return "article";
    case "thread":
      return "thread";
    case "one_liner":
    case "short_post":
    case "regular_post":
      return "post";
    default:
      return "unknown";
  }
}

function referenceScore(reference: StyleReference, toneId: ToneId, lengthId: LengthId) {
  const targetFamily = lengthFamily(lengthId);
  const referenceFamily = lengthFamily(reference.length);
  let score = 0;

  if (reference.length === lengthId) {
    score += 120;
  } else if (referenceFamily === targetFamily) {
    score += 70;
  } else if (referenceFamily !== "unknown" && targetFamily !== "unknown") {
    score -= 140;
  }

  if (reference.tone === toneId) {
    score += 80;
  } else if (reference.tone) {
    score -= 20;
  }

  if (typeof reference.distance === "number") {
    score -= reference.distance * 8;
  }

  return score;
}

function uniqueReferences(references: StyleReference[]) {
  const seen = new Set<string>();

  return references.filter((reference) => {
    const key = reference.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectReferencesForStyle(
  references: StyleReference[],
  toneId: ToneId,
  lengthId: LengthId,
  maxCount: number,
) {
  return uniqueReferences(references)
    .sort((left, right) => referenceScore(right, toneId, lengthId) - referenceScore(left, toneId, lengthId))
    .slice(0, maxCount);
}

function mapReference(
  text: string | null,
  metadata?: TweetMetadata | null,
  distance?: number,
): StyleReference | null {
  const clean = cleanText(text ?? "");
  if (!clean) return null;

  return {
    text: clean,
    notes: metadata?.notes,
    tags: normalizeTags(metadata),
    tone: metadata?.tone ? getToneOption(metadata.tone).id : undefined,
    category: metadata?.category,
    length: metadata?.length ? getLengthOption(metadata.length).id : undefined,
    distance,
  };
}

async function getReferencesFromCollection(
  collectionName: "positive" | "negative",
  source: string,
  toneId: ToneId,
  lengthId: LengthId,
  limit: number,
) {
  const collection =
    collectionName === "positive"
      ? await getTweetExamplesCollection()
      : await getTweetRejectionsCollection();

  const queryText = [source.slice(0, 1600), toneId, lengthId, "reply"].join("\n");
  const results = await collection.query<TweetMetadata>({
    queryTexts: [queryText],
    nResults: limit,
    include: ["documents", "metadatas", "distances"],
  });

  const docs = results.documents?.[0] ?? [];
  const metas = results.metadatas?.[0] ?? [];
  const distances = results.distances?.[0] ?? [];

  return docs
    .map((doc, index) => mapReference(doc ?? null, metas[index] ?? null, distances[index] ?? undefined))
    .filter((item): item is StyleReference => Boolean(item));
}

async function getStyleReferences(source: string, toneId: ToneId, lengthId: LengthId) {
  try {
    const references = await getReferencesFromCollection("positive", source, toneId, lengthId, 24);
    const selected = selectReferencesForStyle(references, toneId, lengthId, 6);

    if (selected.length) return selected;

    const collection = await getTweetExamplesCollection();
    const recent = await collection.get<TweetMetadata>({
      limit: 40,
      include: ["documents", "metadatas"],
    });

    const recentReferences = recent.ids
      .map((_, index) =>
        mapReference(recent.documents?.[index] ?? null, recent.metadatas?.[index] ?? null),
      )
      .filter((item): item is StyleReference => Boolean(item));

    return selectReferencesForStyle(recentReferences, toneId, lengthId, 6);
  } catch {
    return [];
  }
}

async function getAvoidReferences(source: string, toneId: ToneId, lengthId: LengthId) {
  try {
    const references = await getReferencesFromCollection("negative", source, toneId, lengthId, 16);
    return selectReferencesForStyle(references, toneId, lengthId, 3);
  } catch {
    return [];
  }
}

function formatReferences(references: StyleReference[]) {
  if (!references.length) {
    return "No saved examples in the database.";
  }

  const body = references
    .map((reference, index) => {
      const meta = [
        reference.length ? `length=${reference.length}` : "",
        reference.tone ? `tone=${reference.tone}` : "",
        reference.notes ? `note=${reference.notes.slice(0, 80)}` : "",
      ]
        .filter(Boolean)
        .join("; ");

      return `[Example ${index + 1}${meta ? ` | ${meta}` : ""}]\n${reference.text.slice(0, 500)}`;
    })
    .join("\n\n");

  return `These are the writing patterns you must replicate:\n\n${body}`;
}

function formatAvoidReferences(references: StyleReference[]) {
  if (!references.length) return "";

  return references
    .map((reference, index) => `${index + 1}:\n${reference.text.slice(0, 300)}`)
    .join("\n\n");
}

function replyLengthInstruction(lengthId: LengthId) {
  switch (lengthId) {
    case "one_liner":
      return "one concise one-line reply";
    case "short_post":
      return "one short reply";
    case "regular_post":
      return "one natural-length reply";
    case "thread":
      return "one longer reply with short paragraphs if needed";
    case "article":
      return "one detailed reply";
    default:
      return "one reply";
  }
}

function replyCharacterBudget(lengthId: LengthId) {
  switch (lengthId) {
    case "one_liner":
      return 70;
    case "short_post":
      return 160;
    case "regular_post":
      return 260;
    default:
      return 260;
  }
}

function buildShortenMessages(reply: string, maxChars: number): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You shorten replies for X.",
        "Keep the original meaning and voice.",
        "Do not rewrite into a different tone.",
        `Return one reply under ${maxChars} characters.`,
        "Return only the final reply text.",
      ].join("\n"),
    },
    {
      role: "user",
      content: reply,
    },
  ];
}

function truncateToBudget(reply: string, maxChars: number) {
  if (reply.length <= maxChars) return reply;

  const clipped = reply.slice(0, maxChars).trim();
  const lastSpace = clipped.lastIndexOf(" ");
  const safeClip = lastSpace > maxChars * 0.6 ? clipped.slice(0, lastSpace) : clipped;

  return safeClip.replace(/[,\s:;.!?-]+$/g, "").trim();
}

function buildMessages(
  input: GenerateReplyInput,
  references: StyleReference[],
  avoidReferences: StyleReference[],
): ChatMessage[] {
  const tone = getToneOption(input.toneId);
  const avoidBlock = formatAvoidReferences(avoidReferences);
  const cleanHandle = input.authorHandle?.replace(/^@/, "");
  const handleLabel = cleanHandle ? `@${cleanHandle}` : "";
  const nameAsHandle = input.authorName?.trim().replace(/^@/, "");
  const authorLabel =
    handleLabel && nameAsHandle === cleanHandle
      ? handleLabel
      : input.authorName && handleLabel
      ? `${input.authorName} (${handleLabel})`
      : input.authorName || handleLabel || "unknown";
  const authorLine = `Author: ${authorLabel}`;
  const urlLine = input.tweetUrl ? `Source URL: ${input.tweetUrl}` : "";
  const maxChars = replyCharacterBudget(input.lengthId);

  return [
    {
      role: "system",
      content: [
        "You write replies on X.",
        "Your only job is to write one direct reply to the target post.",
        "The target post controls the subject matter. The saved examples control style only.",
        "The examples define voice, sentence rhythm, punctuation, bluntness, and vocabulary level, but never the topic.",
        "Write a real reply, not a standalone post and not a thread.",
        "Stay anchored to the target post and respond to at least one concrete idea, object, claim, or emotion in it.",
        "Do not repeat the target post back word-for-word.",
        "Do not add claims, facts, or context that are not supported by the target post.",
        "Do not mention topics, names, products, or situations from the saved examples unless they also appear in the target post.",
        "If the target post is short or vague, keep the reply equally grounded and do not broaden it into a different topic.",
        "Do not use hashtags, emojis, engagement bait, or generic social media filler unless the examples clearly do.",
        "Keep the reply inside a single X reply and under the requested character budget.",
        "Return only the final reply text.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Reply format: ${replyLengthInstruction(input.lengthId)}`,
        `Feeling: ${tone.label}`,
        `Character budget: under ${maxChars} characters`,
        "",
        "Target post:",
        authorLine,
        input.tweetText,
        ...(urlLine ? [urlLine] : []),
        "",
        "Style examples only. Match the writing style, not the subject matter:",
        formatReferences(references),
        ...(avoidBlock ? ["", "Do not replicate these rejected patterns:\n" + avoidBlock] : []),
      ].join("\n"),
    },
  ];
}

async function requestModelText({
  messages,
  maxTokens,
}: {
  messages: ChatMessage[];
  maxTokens: number;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const endpoint = process.env.OPENROUTER_API_BASE_URL ?? OPENROUTER_ENDPOINT;
  const primaryModel = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-lite";
  const fallbackModel = "openai/gpt-4.1-mini";

  if (!apiKey) {
    throw new Error("API key is not configured. Add OPENROUTER_API_KEY to .env.local.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME ?? "X Master",
  };

  const modelAttempts = [primaryModel];
  if (primaryModel !== fallbackModel) {
    modelAttempts.push(fallbackModel);
  }

  let lastError: string | null = null;

  for (const model of modelAttempts) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;

      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            model,
            messages,
            temperature: Math.max(0.45, 0.6 - attempt * 0.08),
            top_p: 0.9,
            max_tokens: maxTokens,
            stream: false,
            reasoning: { enabled: false },
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          lastError = "Reply generation timed out. Try again.";
          continue;
        }

        throw error;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        lastError = data?.error?.message ?? "Could not generate a reply.";
        continue;
      }

      if (isFilteredResponse(data)) {
        lastError = "The model filtered the reply.";
        break;
      }

      const content = extractCompletionText(data);
      if (content) {
        return content;
      }

      lastError = "The model returned an empty reply.";
    }
  }

  throw new Error(lastError ?? "Could not generate a reply.");
}

export async function generateReply(input: GenerateReplyInput) {
  const tweetText = cleanText(input.tweetText);
  if (!tweetText) {
    throw new Error("Could not find enough tweet text to reply to.");
  }

  const [references, avoidReferences] = await Promise.all([
    getStyleReferences(tweetText, input.toneId, input.lengthId),
    getAvoidReferences(tweetText, input.toneId, input.lengthId),
  ]);

  if (references.length === 0) {
    throw new Error(
      "No style examples found. Add tweets to the Database tab first so reply generation can use your saved voice."
    );
  }

  const maxChars = replyCharacterBudget(input.lengthId);
  let content = await requestModelText({
    messages: buildMessages(input, references, avoidReferences),
    maxTokens: maxTokensForWords(Math.min(getLengthOption(input.lengthId).maxWords, 60)),
  });

  if (content.length > maxChars) {
    try {
      content = await requestModelText({
        messages: buildShortenMessages(content, maxChars),
        maxTokens: maxTokensForWords(40),
      });
    } catch {
      // Fall back to a hard trim if the shortening pass fails.
    }
  }

  content = truncateToBudget(content, maxChars);

  return {
    content,
    referencesUsed: references.length,
    avoidReferencesUsed: avoidReferences.length,
  };
}
