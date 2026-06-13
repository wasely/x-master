import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SEED_PATH = path.resolve("data", "chroma-seed.json");
const DEFAULT_MODEL = "BAAI/bge-small-en-v1.5";
const EMBEDDING_DIMENSIONS = 384;
const EMBED_BATCH_SIZE = 8;
const UPSERT_BATCH_SIZE = 25;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;

      const separator = trimmed.indexOf("=");
      if (separator === -1) return acc;

      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      value = value.replace(/^['"]|['"]$/g, "");
      acc[key] = value;
      return acc;
    }, {});
}

function getEnv() {
  return {
    ...loadEnvFile(path.resolve(".env")),
    ...loadEnvFile(path.resolve(".env.local")),
    ...process.env,
  };
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    seedPath: DEFAULT_SEED_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--seed") {
      args.seedPath = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
  }

  return args;
}

function asEmbeddingList(payload, expectedCount) {
  if (Array.isArray(payload) && payload.every((item) => typeof item === "number")) {
    return [payload];
  }

  if (
    Array.isArray(payload) &&
    payload.every((item) => Array.isArray(item) && item.every((value) => typeof value === "number"))
  ) {
    return payload;
  }

  if (payload?.embeddings) {
    return asEmbeddingList(payload.embeddings, expectedCount);
  }

  throw new Error(`Unexpected embedding response for ${expectedCount} input(s).`);
}

async function embedDocuments(documents, env) {
  const model = env.HUGGINGFACE_EMBEDDING_MODEL || DEFAULT_MODEL;
  const response = await fetch(
    `https://router.huggingface.co/hf-inference/models/${model}/pipeline/feature-extraction`,
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.HUGGINGFACE_API_TOKEN ? { Authorization: `Bearer ${env.HUGGINGFACE_API_TOKEN}` } : {}),
    },
    body: JSON.stringify({ inputs: documents }),
    },
  );

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || responseText || response.statusText;
    throw new Error(`Embedding failed: ${message}`);
  }

  const embeddings = asEmbeddingList(payload, documents.length);
  if (embeddings.length !== documents.length) {
    throw new Error(`Embedding count mismatch: expected ${documents.length}, got ${embeddings.length}.`);
  }

  embeddings.forEach((embedding, index) => {
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding ${index + 1} has ${embedding.length} dimensions; expected ${EMBEDDING_DIMENSIONS}.`,
      );
    }
  });

  return embeddings;
}

async function seedCollection({ db, table, records, env, dryRun }) {
  if (!records.length) {
    console.log(`${table}: no records in seed file.`);
    return;
  }

  if (dryRun) {
    console.log(`${table}: ${records.length} records ready.`);
    return;
  }

  let written = 0;

  for (let start = 0; start < records.length; start += EMBED_BATCH_SIZE) {
    const batch = records.slice(start, start + EMBED_BATCH_SIZE);
    const embeddings = await embedDocuments(
      batch.map((record) => record.document ?? ""),
      env,
    );

    const rows = batch.map((record, index) => ({
      id: record.id,
      document: record.document ?? "",
      metadata: record.metadata ?? {},
      embedding: embeddings[index],
    }));

    for (let upsertStart = 0; upsertStart < rows.length; upsertStart += UPSERT_BATCH_SIZE) {
      const upsertRows = rows.slice(upsertStart, upsertStart + UPSERT_BATCH_SIZE);
      const { error } = await db.from(table).upsert(upsertRows, { onConflict: "id" });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
      written += upsertRows.length;
    }

    console.log(`${table}: seeded ${Math.min(start + batch.length, records.length)}/${records.length}`);
  }

  console.log(`${table}: upserted ${written} records.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = getEnv();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  if (!existsSync(args.seedPath)) {
    throw new Error(`Seed file not found: ${args.seedPath}`);
  }

  const seed = JSON.parse(readFileSync(args.seedPath, "utf8"));
  const collections = seed.collections ?? {};
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  await seedCollection({
    db,
    table: env.VECTOR_COLLECTION || "tweet_examples",
    records: collections.tweet_examples ?? [],
    env,
    dryRun: args.dryRun,
  });

  await seedCollection({
    db,
    table: env.VECTOR_REJECTION_COLLECTION || "tweet_rejections",
    records: collections.tweet_rejections ?? [],
    env,
    dryRun: args.dryRun,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
