import { NextResponse } from "next/server";
import {
  ContentMode,
  LengthId,
  ToneId,
  getLengthOption,
  getToneOption,
} from "@/lib/content-options";
import { generateContentBatch } from "@/lib/generation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      source?: unknown;
      input?: unknown;
      mode?: unknown;
      tone?: unknown;
      toneId?: unknown;
      length?: unknown;
      lengthId?: unknown;
      useLibrary?: unknown;
      count?: unknown;
    };

    const source =
      typeof body.source === "string"
        ? body.source.trim()
        : typeof body.input === "string"
          ? body.input.trim()
          : "";
    const mode: ContentMode = body.mode === "tiktok" ? "tiktok" : "topic";
    const tone = getToneOption(body.toneId ?? body.tone).id as ToneId;
    const length = getLengthOption(body.lengthId ?? body.length).id as LengthId;
    const useLibrary = typeof body.useLibrary === "boolean" ? body.useLibrary : true;
    const count = Number.isFinite(Number(body.count))
      ? Math.max(1, Math.min(Math.trunc(Number(body.count)), 5))
      : mode === "tiktok"
        ? 5
        : 3;

    const result = await generateContentBatch({
      source,
      mode,
      toneId: tone,
      lengthId: length,
      useLibrary,
    }, count);

    return NextResponse.json({
      content: result.generations[0]?.content ?? "",
      generations: result.generations,
      referencesUsed: result.referencesUsed,
      avoidReferencesUsed: result.avoidReferencesUsed,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate content." },
      { status: 500 },
    );
  }
}
