import { execFile } from "child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ERROR_RESPONSE = { error: "Could not extract captions from this video" };
const execFileAsync = promisify(execFile);

function cleanSubtitleText(subtitle: string) {
  const cleanedLines = subtitle
    .replace(/^\uFEFF/, "")
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

function findSubtitleFile(tempFolder: string) {
  return readdirSync(tempFolder)
    .filter((fileName) => /\.(vtt|srt)$/i.test(fileName))
    .sort((left, right) => {
      const leftScore = /\.en[\.-]/i.test(left) ? 0 : 1;
      const rightScore = /\.en[\.-]/i.test(right) ? 0 : 1;

      return leftScore - rightScore;
    })
    .map((fileName) => path.join(tempFolder, fileName))
    .at(0);
}

function buildCommandArgs({ url, outputPath }: { url: string; outputPath: string }) {
  return [
    "--write-auto-sub",
    "--write-sub",
    "--skip-download",
    "--sub-langs",
    "en.*,eng.*,en-US,eng-US,en",
    "--no-playlist",
    "--no-warnings",
    "--retries",
    "0",
    "--extractor-retries",
    "0",
    "--socket-timeout",
    "8",
    "--output",
    outputPath,
    url,
  ];
}

async function runYtDlp(args: string[]) {
  await execFileAsync("yt-dlp", args, {
    timeout: 20000,
    windowsHide: true,
  });
}

export async function POST(request: Request) {
  let tempFolder = "";

  try {
    const body = (await request.json()) as { url?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";

    if (!url.startsWith("https")) {
      return NextResponse.json(ERROR_RESPONSE, { status: 400 });
    }

    tempFolder = mkdtempSync(path.join(os.tmpdir(), "x-master-captions-"));
    const outputPath = path.join(tempFolder, "captions");
    const commandArgs = buildCommandArgs({ url, outputPath });

    try {
      await runYtDlp(commandArgs);
    } catch {
      // Some TikToks still yield usable subtitle files even when yt-dlp exits non-zero.
    }

    const subtitleFile = findSubtitleFile(tempFolder);
    if (!subtitleFile) {
      return NextResponse.json(ERROR_RESPONSE, { status: 400 });
    }

    const subtitle = readFileSync(subtitleFile, "utf8");
    const captions = cleanSubtitleText(subtitle);
    unlinkSync(subtitleFile);

    if (!captions) {
      return NextResponse.json(ERROR_RESPONSE, { status: 400 });
    }

    return NextResponse.json({ captions });
  } catch {
    return NextResponse.json(ERROR_RESPONSE, { status: 400 });
  } finally {
    if (tempFolder && existsSync(tempFolder)) {
      rmSync(tempFolder, { recursive: true, force: true });
    }
  }
}
