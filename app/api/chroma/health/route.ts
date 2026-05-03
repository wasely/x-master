import { NextResponse } from "next/server";
import {
  getChromaClient,
  getChromaSettings,
  getChromaStartCommand,
  getTweetExamplesCollection,
  getTweetRejectionsCollection,
} from "@/lib/chroma";

export const runtime = "nodejs";

export async function GET() {
  const settings = getChromaSettings();

  try {
    const client = getChromaClient();
    const heartbeat = await client.heartbeat();
    const collection = await getTweetExamplesCollection();
    const count = await collection.count();
    const rejectionCollection = await getTweetRejectionsCollection();
    const rejectionCount = await rejectionCollection.count();

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
