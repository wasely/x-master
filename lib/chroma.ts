/**
 * Vector DB abstraction backed by Supabase pgvector.
 * The exported names stay Chroma-compatible so the rest of the app does not
 * need to care which vector store is behind them.
 */
import { createClient } from "@supabase/supabase-js";
import type { TweetMetadata } from "./tweets";

const TABLE_EXAMPLES = process.env.VECTOR_COLLECTION ?? "tweet_examples";
const TABLE_REJECTIONS = process.env.VECTOR_REJECTION_COLLECTION ?? "tweet_rejections";
const EMBEDDING_DIMENSIONS = 384;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  return createClient(url, key);
}

function asEmbeddingList(payload: unknown, expectedCount: number): number[][] {
  if (Array.isArray(payload) && payload.every((item) => typeof item === "number")) {
    return [payload as number[]];
  }

  if (
    Array.isArray(payload) &&
    payload.every((item) => Array.isArray(item) && item.every((value) => typeof value === "number"))
  ) {
    return payload as number[][];
  }

  if (payload && typeof payload === "object" && "embeddings" in payload) {
    return asEmbeddingList((payload as { embeddings: unknown }).embeddings, expectedCount);
  }

  throw new Error(`Unexpected embedding response for ${expectedCount} input(s).`);
}

async function embed(texts: string[]): Promise<number[][]> {
  const model = process.env.HUGGINGFACE_EMBEDDING_MODEL ?? "BAAI/bge-small-en-v1.5";
  const res = await fetch(
    `https://router.huggingface.co/hf-inference/models/${model}/pipeline/feature-extraction`,
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

  const responseText = await res.text();
  let payload: unknown = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(`Embedding failed: ${responseText || res.statusText}`);
  }

  const embeddings = asEmbeddingList(payload, texts.length);
  embeddings.forEach((embedding, index) => {
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding ${index + 1} has ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}.`,
      );
    }
  });

  return embeddings;
}

// Collection wrapper that mirrors the old ChromaDB interface.
class VectorCollection {
  private table: string;

  constructor(table: string) {
    this.table = table;
  }

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
    const db = getSupabase();
    const embeddings = await embed(documents.map((document) => document ?? ""));
    const rows = ids.map((id, index) => ({
      id,
      document: documents[index] ?? "",
      metadata: metadatas[index] ?? {},
      embedding: embeddings[index] ?? [],
    }));
    const { error } = await db.from(this.table).upsert(rows, { onConflict: "id" });
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
    const db = getSupabase();
    const [embedding] = await embed([queryTexts[0] ?? ""]);
    const { data, error } = await db.rpc(`match_${this.table}`, {
      query_embedding: embedding,
      match_count: nResults,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; document: string; metadata: M; similarity: number }>;
    return {
      ids: [rows.map((row) => row.id)],
      documents: [rows.map((row) => row.document ?? null)],
      metadatas: [rows.map((row) => row.metadata ?? null)],
      distances: [rows.map((row) => row.similarity)],
    };
  }

  async get<M = TweetMetadata>({
    limit,
  }: {
    limit?: number;
    include?: string[];
  } = {}) {
    const db = getSupabase();
    let query = db.from(this.table).select("id, document, metadata").order("id");
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; document: string; metadata: M }>;
    return {
      ids: rows.map((row) => row.id),
      documents: rows.map((row) => row.document ?? null),
      metadatas: rows.map((row) => row.metadata ?? null),
    };
  }

  async delete({ ids }: { ids: string[] }) {
    const db = getSupabase();
    const { error } = await db.from(this.table).delete().in("id", ids);
    if (error) throw new Error(error.message);
  }
}

// Public API using the same names as the previous chroma.ts.
export function getChromaSettings() {
  return {
    provider: "supabase_pgvector",
    url: process.env.SUPABASE_URL ?? "(not set)",
    collection: TABLE_EXAMPLES,
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
  return "No local Chroma server needed; using Supabase pgvector.";
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
