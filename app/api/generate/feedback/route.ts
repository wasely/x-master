import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getTweetExamplesCollection, getTweetRejectionsCollection } from "@/lib/chroma";
import { buildTweetMetadata } from "@/lib/tweets";

export const runtime = "nodejs";

function hashId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 18);
}

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      details: details instanceof Error ? details.message : details,
    },
    { status },
  );
}

export async function POST(request: Request) {
  let body: {
    action?: unknown;
    text?: unknown;
    mode?: unknown;
    toneId?: unknown;
    lengthId?: unknown;
    source?: unknown;
    notes?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const action = body.action === "dislike" ? "dislike" : "like";
  const mode = body.mode === "tiktok" ? "tiktok" : "topic";
  const tone = typeof body.toneId === "string" && body.toneId.trim() ? body.toneId.trim() : undefined;
  const length =
    typeof body.lengthId === "string" && body.lengthId.trim() ? body.lengthId.trim() : undefined;
  const source = typeof body.source === "string" ? body.source.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!text) {
    return jsonError("Missing generated text.", 400);
  }

  const createdAt = new Date().toISOString();
  const collection =
    action === "like" ? await getTweetExamplesCollection() : await getTweetRejectionsCollection();
  const id = `${action}-${hashId(`${mode}:${tone ?? ""}:${length ?? ""}:${source}:${text}`)}`;
  const metadata = buildTweetMetadata({
    sourceType: "manual",
    createdAt,
    notes: [notes, `generated:${action}`, source ? `source:${source}` : ""]
      .filter(Boolean)
      .join(" | "),
    tags: [action, mode, tone, length].filter((value): value is string => Boolean(value)),
    tone,
    category: action === "like" ? "generated" : "rejected",
    length,
  });

  try {
    await collection.upsert({
      ids: [id],
      documents: [text],
      metadatas: [metadata],
    });

    return NextResponse.json({
      ok: true,
      action,
      id,
    });
  } catch (error) {
    return jsonError("Could not save generation feedback.", 503, error);
  }
}
