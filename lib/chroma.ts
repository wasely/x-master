import { ChromaClient } from "chromadb";

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 8000;
const DEFAULT_COLLECTION = "tweet_examples";
const DEFAULT_REJECTION_COLLECTION = "tweet_rejections";

export function getChromaSettings() {
  return {
    host: process.env.CHROMA_HOST ?? DEFAULT_HOST,
    port: Number(process.env.CHROMA_PORT ?? DEFAULT_PORT),
    ssl: process.env.CHROMA_SSL === "true",
    collection: process.env.CHROMA_COLLECTION ?? DEFAULT_COLLECTION,
    rejectionCollection:
      process.env.CHROMA_REJECTION_COLLECTION ?? DEFAULT_REJECTION_COLLECTION,
  };
}

export function getChromaClient() {
  const settings = getChromaSettings();

  return new ChromaClient({
    host: settings.host,
    port: settings.port,
    ssl: settings.ssl,
  });
}

export async function getChromaCollection(name: string) {
  const client = getChromaClient();

  return client.getOrCreateCollection({
    name,
  });
}

export async function getTweetExamplesCollection() {
  const settings = getChromaSettings();

  return getChromaCollection(settings.collection);
}

export async function getTweetRejectionsCollection() {
  const settings = getChromaSettings();

  return getChromaCollection(settings.rejectionCollection);
}

export function getChromaStartCommand() {
  return "npm run chroma:run";
}
