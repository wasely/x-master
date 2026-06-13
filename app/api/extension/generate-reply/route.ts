import { NextResponse } from "next/server";
import { getLengthOption, getToneOption, LengthId, ToneId } from "@/lib/content-options";
import { generateReply } from "@/lib/reply-generation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tweetText?: unknown;
      tweetUrl?: unknown;
      authorName?: unknown;
      authorHandle?: unknown;
      toneId?: unknown;
      tone?: unknown;
      lengthId?: unknown;
      length?: unknown;
    };

    const tweetText = typeof body.tweetText === "string" ? body.tweetText.trim() : "";
    const tweetUrl = typeof body.tweetUrl === "string" ? body.tweetUrl.trim() : "";
    const authorName = typeof body.authorName === "string" ? body.authorName.trim() : "";
    const authorHandle =
      typeof body.authorHandle === "string" ? body.authorHandle.trim().replace(/^@/, "") : "";
    const toneId = getToneOption(body.toneId ?? body.tone).id as ToneId;
    const lengthId = getLengthOption(body.lengthId ?? body.length).id as LengthId;

    if (!tweetText) {
      return NextResponse.json({ error: "Could not find enough tweet text to reply to." }, { status: 400 });
    }

    const result = await generateReply({
      tweetText,
      tweetUrl: tweetUrl || undefined,
      authorName: authorName || undefined,
      authorHandle: authorHandle || undefined,
      toneId,
      lengthId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate a reply." },
      { status: 500 },
    );
  }
}
