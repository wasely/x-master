const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function cleanText(value: string) {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function normalizeEnhancedReply(value: string) {
  let output = cleanText(value)
    .replace(/^```[\w-]*\s*/i, "")
    .replace(/\s*```$/, "")
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
    return normalizeEnhancedReply(
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
    return normalizeEnhancedReply(rawContent);
  }

  return "";
}

function maxTokensForText(input: string) {
  const wordCount = input.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(Math.max(wordCount * 3, 140), 700);
}

export async function enhanceReply(text: string) {
  const input = cleanText(text);
  if (!input) {
    throw new Error("Enter a reply draft first.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("API key is not configured. Add OPENROUTER_API_KEY to .env.local.");
  }

  const endpoint = process.env.OPENROUTER_API_BASE_URL ?? OPENROUTER_ENDPOINT;
  const primaryModel = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-lite";
  const fallbackModel = "openai/gpt-4.1-mini";
  const models = primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME ?? "X Master",
  };

  const messages = [
    {
      role: "system",
      content: [
        "You edit replies for X.",
        "Improve grammar, clarity, and flow while preserving the writer's original meaning, tone, and wording wherever possible.",
        "Make the minimum necessary changes.",
        "Do not rewrite in a different voice.",
        "Do not add new claims, slang, hashtags, emojis, or stronger opinions.",
        "Do not turn casual writing into corporate writing.",
        "Keep the reply about the same length.",
        "Return only the edited reply text.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "Lightly polish this X reply draft.",
        "Keep the same intent and mostly the same words.",
        "",
        input,
      ].join("\n"),
    },
  ];

  let lastError = "Could not enhance reply.";

  for (const model of models) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: maxTokensForText(input),
        stream: false,
        reasoning: { enabled: false },
      }),
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("Enhancement timed out. Try again.");
      }
      throw error;
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      lastError = data?.error?.message ?? `OpenRouter returned ${response.status}.`;
      continue;
    }

    const content = extractCompletionText(data);
    if (content) {
      return content;
    }

    lastError = "The model returned an empty response.";
  }

  throw new Error(lastError);
}
