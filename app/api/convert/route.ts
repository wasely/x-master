import { NextResponse } from "next/server";
import { getToneOption } from "@/lib/content-options";
import { generateContent } from "@/lib/generation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: unknown;
      captions?: unknown;
      input?: unknown;
      tone?: unknown;
      useLibrary?: unknown;
    };
    const text =
      typeof body.text === "string"
        ? body.text.trim()
        : typeof body.captions === "string"
          ? body.captions.trim()
          : typeof body.input === "string"
            ? body.input.trim()
            : "";

    if (!text) {
      return NextResponse.json({ error: "Enter text or a TikTok URL to convert." }, { status: 400 });
    }

    const result = await generateContent({
      source: text,
      mode: "tiktok",
      toneId: getToneOption(body.tone).id,
      lengthId: "long",
      useLibrary: typeof body.useLibrary === "boolean" ? body.useLibrary : true,
    });

    return NextResponse.json({ tweet: result.content, content: result.content });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate tweet." },
      { status: 500 },
    );
  }
}
