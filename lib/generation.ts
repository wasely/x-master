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

type ChatMessage = {
  role: "system" | "user";
  content: string;
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

function splitIntoSegments(value: string) {
  const sentenceSegments = value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((segment) => cleanText(segment))
    .filter(Boolean);

  if (sentenceSegments.length > 1) {
    return sentenceSegments;
  }

  const words = value.split(/\s+/).filter(Boolean);
  const wordSegments: string[] = [];

  for (let index = 0; index < words.length; index += 18) {
    wordSegments.push(words.slice(index, index + 18).join(" "));
  }

  return wordSegments;
}

function condenseTikTokSource(source: string) {
  const charBudget = 3600;

  if (source.length <= charBudget) {
    return source;
  }

  const segments = splitIntoSegments(source);
  if (!segments.length) {
    return source.slice(0, charBudget).trim();
  }

  const selected: string[] = [];
  const seen = new Set<string>();
  const targetSegments = Math.min(18, segments.length);

  for (let step = 0; step < targetSegments; step += 1) {
    const index =
      targetSegments === 1 ? 0 : Math.round((step * (segments.length - 1)) / (targetSegments - 1));
    const segment = segments[index];
    const key = segment.toLowerCase();

    if (!segment || seen.has(key)) continue;

    const nextValue = [...selected, segment].join(" ");
    if (nextValue.length > charBudget) break;

    seen.add(key);
    selected.push(segment);
  }

  return selected.join(" ").trim() || source.slice(0, charBudget).trim();
}

function prepareSourceForGeneration(input: GenerateContentInput) {
  const source = cleanText(input.source);

  if (!source) {
    return source;
  }

  if (input.mode !== "tiktok") {
    return source;
  }

  return condenseTikTokSource(source);
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

function selectReferencesForStyle(
  references: StyleReference[],
  toneId: ToneId,
  lengthId: LengthId,
  maxCount: number,
) {
  const unique = uniqueReferences(references);
  const targetFamily = lengthFamily(lengthId);
  const exactMatches = unique.filter(
    (reference) => reference.length === lengthId && reference.tone === toneId,
  );
  const sameLengthMatches = unique.filter(
    (reference) => reference.length === lengthId && reference.tone !== toneId,
  );
  const sameToneSameFamilyMatches = unique.filter(
    (reference) =>
      reference.length !== lengthId &&
      reference.tone === toneId &&
      lengthFamily(reference.length) === targetFamily,
  );
  const sameFamilyMatches = unique.filter(
    (reference) =>
      reference.length !== lengthId &&
      lengthFamily(reference.length) === targetFamily,
  );
  const toneOnlyCrossFamilyMatches = unique.filter(
    (reference) =>
      reference.tone === toneId &&
      lengthFamily(reference.length) !== targetFamily,
  );
  const everythingElse = unique.filter(
    (reference) =>
      reference.tone !== toneId &&
      lengthFamily(reference.length) !== targetFamily,
  );
  const familySpecificMatches = [
    ...exactMatches,
    ...sameLengthMatches,
    ...sameToneSameFamilyMatches,
    ...sameFamilyMatches,
  ];
  const ordered = familySpecificMatches.length
    ? familySpecificMatches
    : [
        ...toneOnlyCrossFamilyMatches,
        ...everythingElse,
      ];

  return uniqueReferences(ordered)
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
      24,
    );
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
      16,
    );

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

function buildSystemPrompt() {
  return [
    "You are a ghostwriter. Write new content about the given topic using the writing STYLE shown in the examples.",
    "The examples define HOW to write: rhythm, line breaks, punctuation, vocabulary level, hook structure, paragraph pacing.",
    "The examples do NOT define what to write about — the topic and ideas come entirely from the source.",
    "NEVER copy sentences, phrases, or ideas from the examples into the output.",
    "NEVER include @mentions, URLs, hashtags, or the names/handles of any specific people or accounts.",
    "NEVER add calls to action, engagement bait, or rhetorical questions unless the examples consistently use them.",
    "NEVER invent fake statistics, case studies, or personal stories not implied by the source.",
    "If the examples are plain prose, write plain prose. If they are punchy one-liners, write punchy one-liners.",
    "Follow the requested length format strictly: posts stay posts, threads stay threads, articles stay articles.",
    "Return only the final post text. No labels, no markdown, no meta-commentary.",
  ].join("\n");
}

function buildPromptSections(
  input: GenerateContentInput,
  references: StyleReference[],
  avoidReferences: StyleReference[],
) {
  const length = getLengthOption(input.lengthId);
  const tone = getToneOption(input.toneId);
  const sourceLabel = input.mode === "tiktok" ? "TikTok transcript or idea" : "Topic";
  const modeInstruction =
    input.mode === "tiktok"
      ? "Pull the core idea from the source. Express it using the SAME writing patterns as the examples — their sentence structure, hooks, vocabulary. Ignore TikTok format conventions."
      : "The topic is what to write about. The examples define HOW to write it. Express the topic only through the patterns shown in the examples. Produce no content that couldn't be explained by those patterns.";

  const avoidBlock = formatAvoidReferences(avoidReferences);
  const sections = [
    `Output format: ${length.outputType}`,
    `Length: ${length.range}`,
    `Tone/feeling: ${tone.label}`,
    modeInstruction,
    "",
    formatReferences(references),
    ...(avoidBlock ? ["", "Do not replicate these rejected patterns:\n" + avoidBlock] : []),
  ];

  return { sourceLabel, sections };
}

function buildVariantInstruction(variantIndex: number, variantCount: number) {
  const structuralApproaches = [
    "Use the structural opening pattern of the first example as your base.",
    "Use a different example's structural pattern as your base — same voice, different sentence arrangement.",
    "Start the piece differently from the other variants while keeping the exact same voice and vocabulary style.",
    "Vary the rhythm and line length from the other variants. Same voice, different pacing.",
    "Use the most minimal example's approach — stripped down, same voice.",
  ];

  return [
    `Variant ${variantIndex + 1} of ${variantCount}.`,
    structuralApproaches[variantIndex % structuralApproaches.length],
    "The writing style must match the examples exactly. Only the structural approach varies across variants.",
  ].join(" ");
}

function buildSingleMessages(
  input: GenerateContentInput,
  references: StyleReference[],
  avoidReferences: StyleReference[],
  variantIndex: number,
  variantCount: number,
): ChatMessage[] {
  const { sourceLabel, sections } = buildPromptSections(input, references, avoidReferences);

  return [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        ...sections,
        "",
        buildVariantInstruction(variantIndex, variantCount),
        "",
        `${sourceLabel}:`,
        input.source,
      ].join("\n"),
    },
  ];
}

function buildBatchMessages(
  input: GenerateContentInput,
  references: StyleReference[],
  avoidReferences: StyleReference[],
  variantCount: number,
): ChatMessage[] {
  const variantTargets = Array.from({ length: variantCount }, (_, index) =>
    `Variant ${index + 1}: ${buildVariantInstruction(index, variantCount)}`,
  );
  const formatGuide = Array.from({ length: variantCount }, (_, index) => [
    `[[VARIANT ${index + 1}]]`,
    `<content for variant ${index + 1}>`,
  ]).flat();
  const { sourceLabel, sections } = buildPromptSections(input, references, avoidReferences);

  return [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        ...sections,
        "",
        `Generate exactly ${variantCount} distinct variations.`,
        "Each variation uses the same voice and style as the examples — only the structural approach differs across variants.",
        "Return the variations in this exact format and do not add any extra text:",
        ...formatGuide,
        "",
        "Variation targets:",
        ...variantTargets,
        "",
        `${sourceLabel}:`,
        input.source,
      ].join("\n"),
    },
  ];
}

async function requestModelText({
  messages,
  maxTokens,
  temperature,
  timeoutMs,
  attemptsPerModel,
}: {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  attemptsPerModel: number;
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

  let lastError: string | null = null;
  const modelAttempts = [primaryModel];

  if (primaryModel !== fallbackModel) {
    modelAttempts.push(fallbackModel);
  }

  for (const model of modelAttempts) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
      let response: Response;

      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model,
            messages,
            temperature: Math.min(temperature - attempt * 0.03, 0.95),
            top_p: 0.9,
            max_tokens: maxTokens,
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
        return content;
      }

      lastError = "The model returned an empty response.";
    }
  }

  throw new Error(lastError ?? "Could not generate content.");
}

function withSequentialIds(generations: GeneratedContent[]) {
  return generations.map((generation, index) => ({
    ...generation,
    id: `${index + 1}`,
  }));
}

function parseBatchGenerations(content: string) {
  const markerMatches = Array.from(
    content.matchAll(/\[\[VARIANT\s+(\d+)\]\]\s*([\s\S]*?)(?=\n\[\[VARIANT\s+\d+\]\]|\s*$)/gi),
  );

  if (markerMatches.length) {
    return markerMatches
      .map((match, index) => ({
        id: match[1] ?? `${index + 1}`,
        content: normalizeGeneratedContent(match[2] ?? ""),
      }))
      .filter((generation) => generation.content);
  }

  const titledMatches = Array.from(
    content.matchAll(
      /(?:^|\n)(?:variant|option|post)\s*(\d+)\s*:?\s*([\s\S]*?)(?=\n(?:variant|option|post)\s*\d+\s*:?\s*|$)/gi,
    ),
  );

  if (titledMatches.length) {
    return titledMatches
      .map((match, index) => ({
        id: match[1] ?? `${index + 1}`,
        content: normalizeGeneratedContent(match[2] ?? ""),
      }))
      .filter((generation) => generation.content);
  }

  const fallback = normalizeGeneratedContent(content);
  return fallback ? [{ id: "1", content: fallback }] : [];
}

async function generateBatchContent(
  input: GenerateContentInput,
  source: string,
  references: StyleReference[],
  avoidReferences: StyleReference[],
  variantCount: number,
) {
  const length = getLengthOption(input.lengthId);
  const messages = buildBatchMessages(
    { ...input, source },
    references,
    avoidReferences,
    variantCount,
  );
  const rawContent = await requestModelText({
    messages,
    maxTokens: maxTokensForWords(length.maxWords * variantCount),
    temperature: 0.65,
    timeoutMs: 30000,
    attemptsPerModel: 1,
  });

  return uniqueGenerations(parseBatchGenerations(rawContent));
}

async function generateSingleContent(
  input: GenerateContentInput,
  source: string,
  references: StyleReference[],
  avoidReferences: StyleReference[],
  variantIndex: number,
  variantCount: number,
) {
  const length = getLengthOption(input.lengthId);
  const messages = buildSingleMessages(
    { ...input, source },
    references,
    avoidReferences,
    variantIndex,
    variantCount,
  );
  const content = await requestModelText({
    messages,
    maxTokens: maxTokensForWords(length.maxWords),
    temperature: 0.60 + variantIndex * 0.07,
    timeoutMs: 25000,
    attemptsPerModel: 2,
  });

  return {
    id: `${variantIndex + 1}`,
    content,
  } satisfies GeneratedContent;
}

export async function generateContentBatch(input: GenerateContentInput, count = 3) {
  const source = prepareSourceForGeneration(input);

  if (!source) {
    throw new Error("Enter something to generate from.");
  }

  const [references, avoidReferences] = await Promise.all([
    getStyleReferences({
      source,
      toneId: input.toneId,
      lengthId: input.lengthId,
      useLibrary: input.useLibrary ?? true,
    }),
    getAvoidReferences({
      source,
      toneId: input.toneId,
      lengthId: input.lengthId,
      useLibrary: input.useLibrary ?? true,
    }),
  ]);

  if (references.length === 0) {
    throw new Error(
      "No style examples found. Add tweets to the Database tab to train the generator on your voice, or check that the library is online."
    );
  }

  const variantCount = Math.max(1, Math.min(Math.trunc(count), 5));
  let generations: GeneratedContent[] = [];
  let firstError: Error | null = null;

  try {
    generations = await generateBatchContent(input, source, references, avoidReferences, variantCount);
  } catch (error) {
    firstError = error instanceof Error ? error : new Error("Could not generate content.");
  }

  for (let round = 0; generations.length < variantCount && round < 2; round += 1) {
    const missingCount = variantCount - generations.length;
    const settledFallbacks = await Promise.allSettled(
      Array.from({ length: missingCount * 2 }, (_, index) =>
        generateSingleContent(
          input,
          source,
          references,
          avoidReferences,
          generations.length + round * 5 + index,
          variantCount,
        ),
      ),
    );

    const fallbackGenerations = settledFallbacks
      .filter((result): result is PromiseFulfilledResult<GeneratedContent> => result.status === "fulfilled")
      .map((result) => result.value);

    generations = uniqueGenerations([...generations, ...fallbackGenerations]);

    if (!firstError) {
      const rejected = settledFallbacks.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (rejected?.reason instanceof Error) {
        firstError = rejected.reason;
      }
    }
  }

  generations = withSequentialIds(generations.slice(0, variantCount));

  if (!generations.length) {
    throw firstError ?? new Error("Could not generate content.");
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
