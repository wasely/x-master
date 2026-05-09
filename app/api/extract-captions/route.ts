import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ERROR_RESPONSE = { error: "Could not extract captions from this video" };

function cleanSubtitleText(subtitle: string) {
  const cleanedLines = subtitle
    .replace(/^﻿/, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => {
      if (!line) return false;
      if (/^\d+$/.test(line)) return false;
      if (/-->/.test(line)) return false;
      if (/^(WEBVTT|Kind:|Language:|NOTE|STYLE|REGION)$/i.test(line)) return false;
      return true;
    });

  return cleanedLines
    .filter((line, index, lines) => line !== lines[index - 1])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function findEnglishSubtitleUrl(subtitleInfos: unknown): string | null {
  if (!Array.isArray(subtitleInfos) || subtitleInfos.length === 0) return null;

  const entries = subtitleInfos as Array<Record<string, unknown>>;
  const english = entries.find(
    (s) => typeof s.LanguageCodeName === "string" && s.LanguageCodeName.toLowerCase().startsWith("en"),
  );
  const chosen = english ?? entries[0];
  return typeof chosen?.Url === "string" ? chosen.Url : null;
}

function extractSubtitleUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;

  // __UNIVERSAL_DATA_FOR_REHYDRATION__ format (current TikTok web app)
  try {
    const scope = obj["__DEFAULT_SCOPE__"] as Record<string, unknown> | undefined;
    const videoDetail = scope?.["webapp.video-detail"] as Record<string, unknown> | undefined;
    const itemStruct = (videoDetail?.["itemInfo"] as Record<string, unknown> | undefined)?.["itemStruct"] as
      | Record<string, unknown>
      | undefined;
    const url = findEnglishSubtitleUrl(
      (itemStruct?.["video"] as Record<string, unknown> | undefined)?.["subtitleInfos"],
    );
    if (url) return url;
  } catch {}

  // SIGI_STATE format (older TikTok pages)
  try {
    const itemModule = obj["ItemModule"] as Record<string, Record<string, unknown>> | undefined;
    if (itemModule) {
      for (const videoId of Object.keys(itemModule)) {
        const video = itemModule[videoId]?.["video"] as Record<string, unknown> | undefined;
        const url = findEnglishSubtitleUrl(video?.["subtitleInfos"]);
        if (url) return url;
      }
    }
  } catch {}

  return null;
}

async function fetchTikTokPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`TikTok returned ${res.status}`);
  return res.text();
}

function parseSubtitleUrlFromHtml(html: string): string | null {
  // Try __UNIVERSAL_DATA_FOR_REHYDRATION__ (script tag with JSON content)
  const universalMatch = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (universalMatch?.[1]) {
    try {
      return extractSubtitleUrl(JSON.parse(universalMatch[1]));
    } catch {}
  }

  // Try SIGI_STATE (inline JS assignment)
  const sigiMatch = html.match(/window\[['"]SIGI_STATE['"]\]\s*=\s*(\{[\s\S]*?\});\s*(?:window\[|<\/script>)/);
  if (sigiMatch?.[1]) {
    try {
      return extractSubtitleUrl(JSON.parse(sigiMatch[1]));
    } catch {}
  }

  return null;
}

async function captionsViaHtmlScrape(url: string): Promise<string | null> {
  try {
    const html = await fetchTikTokPage(url);
    const subtitleUrl = parseSubtitleUrlFromHtml(html);
    if (!subtitleUrl) return null;

    const subRes = await fetch(subtitleUrl, { signal: AbortSignal.timeout(10000) });
    if (!subRes.ok) return null;

    const captions = cleanSubtitleText(await subRes.text());
    return captions || null;
  } catch {
    return null;
  }
}

async function captionsViaOEmbed(url: string): Promise<string | null> {
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const title = typeof data?.title === "string" ? data.title.trim() : "";
    // Require at least 20 chars of real content (not just hashtags/emoji)
    return title.replace(/#\w+/g, "").trim().length >= 20 ? title : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (!url.startsWith("https")) {
      return NextResponse.json(ERROR_RESPONSE, { status: 400 });
    }

    const captions =
      (await captionsViaHtmlScrape(url)) ??
      (await captionsViaOEmbed(url));

    if (!captions) {
      return NextResponse.json(ERROR_RESPONSE, { status: 400 });
    }

    return NextResponse.json({ captions });
  } catch {
    return NextResponse.json(ERROR_RESPONSE, { status: 400 });
  }
}
