import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ERROR_RESPONSE = { error: "Could not extract captions from this video" };

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
    .map((fileName) => path.join(tempFolder, fileName))
    .at(0);
}

function buildCommandArgs({
  url,
  outputPath,
  subtitleFlag,
  subtitleLanguage,
}: {
  url: string;
  outputPath: string;
  subtitleFlag: "--write-auto-sub" | "--write-sub";
  subtitleLanguage: string;
}) {
  return [
    subtitleFlag,
    "--skip-download",
    "--sub-lang",
    subtitleLanguage,
    "--output",
    outputPath,
    url,
  ];
}

function runYtDlp(args: string[]) {
  execFileSync("yt-dlp", args, {
    stdio: "pipe",
    timeout: 45000,
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
    const commandArgs = buildCommandArgs({
      url,
      outputPath,
      subtitleFlag: "--write-auto-sub",
      subtitleLanguage: "en",
    });

    runYtDlp(commandArgs);

    let subtitleFile = findSubtitleFile(tempFolder);
    if (!subtitleFile) {
      const fallbackCommandArgs = buildCommandArgs({
        url,
        outputPath,
        subtitleFlag: "--write-sub",
        subtitleLanguage: "eng-US",
      });

      runYtDlp(fallbackCommandArgs);
      subtitleFile = findSubtitleFile(tempFolder);
    }

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
  } catch (error) {
    return NextResponse.json(ERROR_RESPONSE, { status: 400 });
  } finally {
    if (tempFolder && existsSync(tempFolder)) {
      rmSync(tempFolder, { recursive: true, force: true });
    }
  }
}
