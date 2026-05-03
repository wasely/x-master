import {
  ContentMode,
  LengthId,
  ToneId,
  getLengthOption,
  getToneOption,
} from "@/lib/content-options";
import { getTweetExamplesCollection, getTweetRejectionsCollection } from "@/lib/chroma";
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

export type GenerateContentInput = {
  source: string;
  mode: ContentMode;
  toneId: ToneId;
  lengthId: LengthId;
  useLibrary?: boolean;
};

export type GeneratedContent = {
  id: string;
  content: string;
};

function cleanText(value: string) {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function normalizeGeneratedContent(value: string) {
  let output = cleanText(value)
    .replace(/^```[\w-]*\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(tweet|post|thread|x post)\s*:\s*/i, "")
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
    return normalizeGeneratedContent(
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
    return normalizeGeneratedContent(rawContent);
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
  return Math.min(Math.max(Math.ceil(maxWords * 2.2), 220), 4200);
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

function uniqueGenerations(generations: GeneratedContent[]) {
  const seen = new Set<string>();

  return generations.filter((generation) => {
    const key = generation.content.toLowerCase();
    if (!generation.content || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    tone: metadata?.tone,
    category: metadata?.category,
    length: metadata?.length,
    distance,
  } satisfies StyleReference;
}

async function getReferencesFromCollection(
  collectionName: "positive" | "negative",
  source: string,
  toneId: ToneId,
  lengthId: LengthId,
  useLibrary: boolean,
  limit: number,
) {
  if (!useLibrary) return [];

  try {
    const collection =
      collectionName === "positive"
        ? await getTweetExamplesCollection()
        : await getTweetRejectionsCollection();

    const queryText = [source.slice(0, 1600), toneId, lengthId].join("\n");
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
  } catch {
    return [];
  }
}

async function getStyleReferences({
  source,
  toneId,
  lengthId,
  useLibrary,
}: {
  source: string;
  toneId: ToneId;
  lengthId: LengthId;
  useLibrary: boolean;
}) {
  if (!useLibrary) return [];

  try {
    const references = await getReferencesFromCollection(
      "positive",
      source,
      toneId,
      lengthId,
      useLibrary,
      10,
    );
    const lengthMatches = references.filter((reference) => reference.length === lengthId);
    const toneMatches = references.filter((reference) => reference.tone === toneId);
    const selected = uniqueReferences([...lengthMatches, ...toneMatches, ...references]).slice(0, 6);

    if (selected.length) return selected;

    const collection = await getTweetExamplesCollection();
    const recent = await collection.get<TweetMetadata>({
      limit: 6,
      include: ["documents", "metadatas"],
    });

    return recent.ids
      .map((_, index) =>
        mapReference(recent.documents?.[index] ?? null, recent.metadatas?.[index] ?? null),
      )
      .filter((item): item is StyleReference => Boolean(item));
  } catch {
    return [];
  }
}

async function getAvoidReferences({
  source,
  toneId,
  lengthId,
  useLibrary,
}: {
  source: string;
  toneId: ToneId;
  lengthId: LengthId;
  useLibrary: boolean;
}) {
  if (!useLibrary) return [];

  try {
    const references = await getReferencesFromCollection(
      "negative",
      source,
      toneId,
      lengthId,
      useLibrary,
      6,
    );

    return uniqueReferences(references).slice(0, 4);
  } catch {
    return [];
  }
}

function formatReferences(references: StyleReference[]) {
  if (!references.length) {
    return "No saved examples were available. Write in a sharp, human, non-generic style.";
  }

  return references
    .map((reference, index) => {
      const meta = [
        reference.length ? `length=${reference.length}` : "",
        reference.tone ? `tone=${reference.tone}` : "",
        reference.category ? `category=${reference.category}` : "",
        reference.tags.length ? `tags=${reference.tags.join(", ")}` : "",
        reference.notes ? `why it works=${reference.notes}` : "",
      ]
        .filter(Boolean)
        .join("; ");

      return `Example ${index + 1}${meta ? ` (${meta})` : ""}:\n${reference.text}`;
    })
    .join("\n\n");
}

function formatAvoidReferences(references: StyleReference[]) {
  if (!references.length) {
    return "No rejected examples were available yet.";
  }

  return references
    .map((reference, index) => {
      const meta = [
        reference.length ? `length=${reference.length}` : "",
        reference.tone ? `tone=${reference.tone}` : "",
        reference.category ? `category=${reference.category}` : "",
        reference.tags.length ? `tags=${reference.tags.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");

      return `Rejected Example ${index + 1}${meta ? ` (${meta})` : ""}:\n${reference.text}`;
    })
    .join("\n\n");
}

function buildXStrategyPlaybook(lengthId: LengthId) {
  const baseRules = [
    "This playbook is a secondary optimization layer, never the primary source.",
    "Use it only after the saved database examples and user source are honored.",
    "Choose one clear audience, one clear topic, and one engagement job: reply, repost, bookmark, profile visit, or click.",
    "Use a proven hook shape when it fits the saved examples: counterintuitive insight, hot take, lesson, story hook, direct question, or specific observation.",
    "Algorithm check: improve Real-graph fit with follower-relevant ideas; SimClusters fit with niche language; TwHIN fit with the user's established topics; Tweepcred with credible, useful, non-bait writing.",
    "Maximize positive signals by making the post specific, useful, reply-worthy, shareable, or bookmarkable.",
    "Avoid negative signals: bait, spammy CTAs, toxicity, misleading claims, off-brand pivots, hashtag stuffing, and generic filler.",
  ];

  if (lengthId === "thread") {
    return [
      ...baseRules,
      "For thread output: write a complete numbered thread, not a fragment.",
      "Hook tweet must work alone and create a clear promise.",
      "Use 1/, 2/, 3/ numbering. Keep one idea per tweet with short lines and pacing breaks.",
      "Target 8-12 tweets unless the selected word range forces fewer.",
      "End with a concise CTA to reply, follow, share, or bookmark only when it feels natural.",
    ].join("\n");
  }

  return [
    ...baseRules,
    "For single posts: make it stand alone, put the hook early, avoid overloaded hashtags, and include a question or CTA only when it increases conversation without sounding like bait.",
  ].join("\n");
}

function buildVariantInstruction(variantIndex: number, variantCount: number) {
  const instructions = [
    "Make this the cleanest and most broadly usable option.",
    "Make this sharper, more contrarian, and more likely to trigger a reply.",
    "Make this more practical and bookmark-worthy.",
    "Make this more concise, punchy, and direct.",
    "Make this more nuanced and thoughtful without getting verbose.",
  ];

  return [
    `This is variation ${variantIndex + 1} of ${variantCount}.`,
    instructions[variantIndex % instructions.length],
    "Keep it meaningfully different from the other variations.",
  ].join(" ");
}

function buildMessages(
  input: GenerateContentInput,
  references: StyleReference[],
  avoidReferences: StyleReference[],
  variantIndex: number,
  variantCount: number,
) {
  const length = getLengthOption(input.lengthId);
  const tone = getToneOption(input.toneId);
  const sourceLabel = input.mode === "tiktok" ? "TikTok transcript or idea" : "Topic";
  const modeInstruction =
    input.mode === "tiktok"
      ? "Extract the strongest idea from the source. Do not summarize the video. Turn the useful insight into original writing."
      : "Use the topic as the seed. Do not invent fake personal claims, numbers, dates, or case studies.";

  return [
    {
      role: "system",
      content: [
        "You write X-native content for one user.",
        "Primary source priority: 1. saved database examples for voice, taste, rhythm, structure, and acceptable topic patterns; 2. the user's source for factual content; 3. the X strategy playbook for engagement and packaging.",
        "If the saved examples conflict with the strategy playbook, follow the saved examples.",
        "Use the saved examples to infer the user's taste: grammar, pacing, sentence length, hook shape, specificity, rhythm, humor, and topic categories.",
        "Avoid the rejected examples and do not imitate their structure, hook style, cadence, framing, or topic angle.",
        "Do not mention the database, examples, prompt, transcript, or style analysis.",
        "Return only the final content. No labels, markdown fences, explanations, alternate options, or hashtags unless the source strongly requires one.",
        "Avoid generic motivational filler and AI-sounding phrasing.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Output type: ${length.outputType}`,
        `Required length: ${length.range}`,
        `Tone or feeling: ${tone.label}`,
        modeInstruction,
        "",
        "Saved examples:",
        formatReferences(references),
        "",
        "Rejected examples to avoid:",
        formatAvoidReferences(avoidReferences),
        "",
        buildVariantInstruction(variantIndex, variantCount),
        "",
        "Secondary X strategy playbook:",
        buildXStrategyPlaybook(input.lengthId),
        "",
        `${sourceLabel}:`,
        input.source,
      ].join("\n"),
    },
  ];
}

async function generateOneContent(
  input: GenerateContentInput,
  source: string,
  references: StyleReference[],
  avoidReferences: StyleReference[],
  variantIndex: number,
  variantCount: number,
) {
  const length = getLengthOption(input.lengthId);
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
  };

  headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000";
  headers["X-OpenRouter-Title"] = process.env.OPENROUTER_APP_NAME ?? "X Master";

  const messages = buildMessages(
    { ...input, source },
    references,
    avoidReferences,
    variantIndex,
    variantCount,
  );

  let lastError: string | null = null;

  const modelAttempts = [primaryModel];
  if (primaryModel !== fallbackModel) {
    modelAttempts.push(fallbackModel);
  }

  for (const model of modelAttempts) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;

      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({
            model,
            messages,
            temperature: Math.min(0.75 + variantIndex * 0.07 - attempt * 0.03, 0.95),
            top_p: 0.9,
            max_tokens: maxTokensForWords(length.maxWords),
            stream: false,
            reasoning: { enabled: false },
          }),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          lastError = "Generation timed out. Try again with a shorter source.";
          continue;
        }

        throw error;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        lastError = data?.error?.message ?? "Could not generate content.";
        continue;
      }

      if (isFilteredResponse(data)) {
        lastError = "The model filtered the response.";
        break;
      }

      const content = extractCompletionText(data);

      if (content) {
        return {
          id: `${variantIndex + 1}`,
          content,
        } satisfies GeneratedContent;
      }

      lastError = "The model returned an empty response.";
    }
  }

  throw new Error(lastError ?? "Could not generate content.");
}

export async function generateContentBatch(input: GenerateContentInput, count = 3) {
  const source = cleanText(input.source);

  if (!source) {
    throw new Error("Enter something to generate from.");
  }

  const references = await getStyleReferences({
    source,
    toneId: input.toneId,
    lengthId: input.lengthId,
    useLibrary: input.useLibrary ?? true,
  });
  const avoidReferences = await getAvoidReferences({
    source,
    toneId: input.toneId,
    lengthId: input.lengthId,
    useLibrary: input.useLibrary ?? true,
  });

  const variantCount = Math.max(1, Math.min(Math.trunc(count), 5));
  const settledGenerations = await Promise.allSettled(
    Array.from({ length: variantCount }, (_, index) =>
      generateOneContent(input, source, references, avoidReferences, index, variantCount),
    ),
  );
  const generations = uniqueGenerations(
    settledGenerations
      .filter((result): result is PromiseFulfilledResult<GeneratedContent> => result.status === "fulfilled")
      .map((result) => result.value),
  );

  if (!generations.length) {
    const firstRejected = settledGenerations.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw firstRejected?.reason instanceof Error
      ? firstRejected.reason
      : new Error("Could not generate content.");
  }

  return {
    generations,
    referencesUsed: references.length,
    avoidReferencesUsed: avoidReferences.length,
  };
}

export async function generateContent(input: GenerateContentInput) {
  const result = await generateContentBatch(input, 1);

  return {
    content: result.generations[0]?.content ?? "",
    referencesUsed: result.referencesUsed,
    avoidReferencesUsed: result.avoidReferencesUsed,
  };
}
