import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const RUNTIME_DIR = path.resolve(".runtime");
const DRAFTS_PATH = path.join(RUNTIME_DIR, "drafts.json");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

function jsonError(message: string, status: number) {
  return json({ error: message }, status);
}

type Draft = {
  id: string;
  text: string;
  sourceUrl?: string;
  authorName?: string;
  myDraft: string;
  createdAt: string;
};

function readDrafts(): Draft[] {
  if (!existsSync(DRAFTS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(DRAFTS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeDrafts(drafts: Draft[]) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(DRAFTS_PATH, JSON.stringify(drafts, null, 2), "utf8");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const drafts = readDrafts();
  drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({ drafts });
}

export async function POST(request: Request) {
  let body: { text?: string; sourceUrl?: string; authorName?: string; myDraft?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const text = body.text?.trim();
  if (!text) return jsonError("Missing tweet text.", 400);

  const draft: Draft = {
    id: `draft-${randomUUID()}`,
    text,
    sourceUrl: body.sourceUrl?.trim() || undefined,
    authorName: body.authorName?.trim() || undefined,
    myDraft: body.myDraft?.trim() || "",
    createdAt: new Date().toISOString(),
  };

  const drafts = readDrafts();
  drafts.unshift(draft);
  writeDrafts(drafts);

  return json({ draft }, 201);
}

export async function PATCH(request: Request) {
  let body: { id?: string; myDraft?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const { id, myDraft } = body;
  if (!id) return jsonError("Missing draft id.", 400);

  const drafts = readDrafts();
  const index = drafts.findIndex((d) => d.id === id);
  if (index === -1) return jsonError("Draft not found.", 404);

  drafts[index] = { ...drafts[index], myDraft: myDraft ?? "" };
  writeDrafts(drafts);

  return json({ draft: drafts[index] });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("Missing draft id.", 400);

  const drafts = readDrafts();
  const filtered = drafts.filter((d) => d.id !== id);
  if (filtered.length === drafts.length) return jsonError("Draft not found.", 404);

  writeDrafts(filtered);
  return json({ ok: true });
}
