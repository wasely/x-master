import { NextResponse } from "next/server";
import { enhanceReply } from "@/lib/reply-enhancement";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json({ error: "Enter a reply draft first." }, { status: 400 });
    }

    const content = await enhanceReply(text);
    return NextResponse.json({ content });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not enhance reply." },
      { status: 500 },
    );
  }
}
