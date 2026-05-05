import { NextResponse } from "next/server";
import {
  getChromaClient,
  getChromaSettings,
  getChromaStartCommand,
  getTweetExamplesCollection,
  getTweetRejectionsCollection,
} from "@/lib/chroma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function getLiveCollectionCount(
  collection: Awaited<ReturnType<typeof getTweetExamplesCollection>>,
) {
  const snapshot = await collection.get({
    include: ["documents"],
  });

  return snapshot.ids.length;
}

export async function GET(request: Request) {
  void request.url;
  const settings = getChromaSettings();

  try {
    const client = getChromaClient();
    const heartbeat = await client.heartbeat();
    const collection = await getTweetExamplesCollection();
    const rejectionCollection = await getTweetRejectionsCollection();
    const [count, rejectionCount] = await Promise.all([
      getLiveCollectionCount(collection),
      getLiveCollectionCount(rejectionCollection),
    ]);

    return NextResponse.json({
      ok: true,
      heartbeat,
      count,
      rejectionCount,
      settings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Chroma is not running or is not reachable.",
        details: error instanceof Error ? error.message : String(error),
        startCommand: getChromaStartCommand(),
        settings,
      },
      { status: 503 },
    );
  }
}
