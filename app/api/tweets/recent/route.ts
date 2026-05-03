import { NextResponse } from "next/server";
import { getChromaSettings, getChromaStartCommand, getTweetExamplesCollection } from "@/lib/chroma";
import { TweetMetadata, toTweetRecord } from "@/lib/tweets";

export const runtime = "nodejs";

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseLimit(searchParams.get("limit"));

  try {
    const collection = await getTweetExamplesCollection();
    const results = await collection.get<TweetMetadata>({
      limit,
      include: ["documents", "metadatas"],
    });

    const examples = results.ids
      .map((id, index) =>
        toTweetRecord(id, results.documents?.[index] ?? null, results.metadatas?.[index] ?? null),
      )
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

    return NextResponse.json({ examples });
  } catch (error) {
    return jsonError("Could not read tweet examples from Chroma.", 503, error);
  }
}
