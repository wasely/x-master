/**
 * Vector DB abstraction — backed by Supabase pgvector.
 * Same exports as before so no other files need touching.
 */
import { createClient } from "@supabase/supabase-js";
import type { TweetMetadata } from "./tweets";

const TABLE_EXAMPLES   = process.env.VECTOR_COLLECTION          ?? "tweet_examples";
const TABLE_REJECTIONS = process.env.VECTOR_REJECTION_COLLECTION ?? "tweet_rejections";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  return createClient(url, key);
}

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    "https://api-inference.huggingface.co/models/BAAI/bge-small-en-v1.5",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.HUGGINGFACE_API_TOKEN && {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`,
        }),
      },
      body: JSON.stringify({ inputs: texts }),
    },
  );
  if (!res.ok) throw new Error(`Embedding failed: ${await res.text()}`);
  return res.json() as Promise<number[][]>;
}

// ── Collection wrapper (mirrors the old ChromaDB interface) ───────────────────

class VectorCollection {
  private table: string;
  constructor(table: string) { this.table = table; }

  async upsert({
    ids,
    documents,
    metadatas,
  }: {
    ids: string[];
    documents: string[];
    metadatas: TweetMetadata[];
    uris?: (string | undefined)[];
  }) {
    const db         = getSupabase();
    const embeddings = await embed(documents.map(d => d ?? ""));
    const rows       = ids.map((id, i) => ({
      id,
      document:  documents[i]  ?? "",
      metadata:  metadatas[i]  ?? {},
      embedding: embeddings[i] ?? [],
    }));
    const { error } = await db.from(this.table).upsert(rows);
    if (error) throw new Error(error.message);
  }

  async query<M = TweetMetadata>({
    queryTexts,
    nResults,
  }: {
    queryTexts: string[];
    nResults: number;
    include?: string[];
  }) {
    const db              = getSupabase();
    const [[embedding]]   = await Promise.all([embed([queryTexts[0] ?? ""])]);
    const { data, error } = await db.rpc(`match_${this.table}`, {
      query_embedding: embedding,
      match_count:     nResults,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; document: string; metadata: M; similarity: number }>;
    return {
      ids:       [rows.map(r => r.id)],
      documents: [rows.map(r => r.document ?? null)],
      metadatas: [rows.map(r => r.metadata ?? null)],
      distances: [rows.map(r => r.similarity)],
    };
  }

  async get<M = TweetMetadata>({
    limit,
  }: {
    limit?: number;
    include?: string[];
  } = {}) {
    const db  = getSupabase();
    let q     = db.from(this.table).select("id, document, metadata").order("id");
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; document: string; metadata: M }>;
    return {
      ids:       rows.map(r => r.id),
      documents: rows.map(r => r.document ?? null),
      metadatas: rows.map(r => r.metadata ?? null),
    };
  }

  async delete({ ids }: { ids: string[] }) {
    const db = getSupabase();
    const { error } = await db.from(this.table).delete().in("id", ids);
    if (error) throw new Error(error.message);
  }
}

// ── Public API (same names as old chroma.ts) ──────────────────────────────────

export function getChromaSettings() {
  return {
    url:                 process.env.SUPABASE_URL ?? "(not set)",
    collection:          TABLE_EXAMPLES,
    rejectionCollection: TABLE_REJECTIONS,
  };
}

export function getChromaClient() {
  return {
    heartbeat: async () => {
      const db = getSupabase();
      const { error } = await db.from(TABLE_EXAMPLES).select("id").limit(1);
      return error ? 0 : Date.now();
    },
  };
}

export function getChromaStartCommand() {
  return "No local server needed — using Supabase pgvector";
}

export async function getChromaCollection(name: string) {
  return new VectorCollection(name);
}

export async function getTweetExamplesCollection() {
  return new VectorCollection(TABLE_EXAMPLES);
}

export async function getTweetRejectionsCollection() {
  return new VectorCollection(TABLE_REJECTIONS);
}
