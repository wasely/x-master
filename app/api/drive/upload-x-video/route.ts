import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

type UploadBody = {
  tweetUrl?: unknown;
  tweetText?: unknown;
  authorName?: unknown;
  suggestedName?: unknown;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

function jsonError(message: string, status: number, details?: unknown) {
  return json(
    {
      error: message,
      details: details instanceof Error ? details.message : details,
    },
    status,
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function sanitizeFileName(value: string) {
  const clean = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return clean || "x-video";
}

function extToMimeType(ext: string) {
  switch (ext.toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".m4v":
      return "video/x-m4v";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function normalizeTweetUrl(value: string) {
  return value.replace(/\/video\/\d+\/?$/i, "").trim();
}

function resolveDriveCredentials() {
  const rawJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  const jsonPath = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_PATH;
  const clientEmail = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (rawJson) {
    return JSON.parse(rawJson) as { client_email: string; private_key: string };
  }

  if (jsonPath) {
    return JSON.parse(readFileSync(path.resolve(jsonPath), "utf8")) as {
      client_email: string;
      private_key: string;
    };
  }

  if (clientEmail && privateKey) {
    return { client_email: clientEmail, private_key: privateKey };
  }

  return null;
}

type DriveAuthMode = "oauth-user" | "service-account";

function createDriveClient() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();

  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    return {
      drive: google.drive({ version: "v3", auth }),
      authMode: "oauth-user" as DriveAuthMode,
    };
  }

  const credentials = resolveDriveCredentials();

  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error(
      "Google Drive is not configured. Provide either OAuth env vars (GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN) or service-account credentials.",
    );
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return {
    drive: google.drive({ version: "v3", auth }),
    authMode: "service-account" as DriveAuthMode,
  };
}

async function downloadVideo(tweetUrl: string, tempDir: string) {
  const outputTemplate = path.join(tempDir, "video.%(ext)s");

  await execFileAsync(
    "yt-dlp",
    [
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "-f",
      "b[ext=mp4]/best[ext=mp4]/best",
      "-o",
      outputTemplate,
      tweetUrl,
    ],
    {
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );

  const fileName = readdirSync(tempDir)
    .filter((entry) => !entry.endsWith(".part") && !entry.endsWith(".ytdl"))
    .sort()
    .at(-1);

  if (!fileName) {
    throw new Error("yt-dlp did not produce a video file.");
  }

  return path.join(tempDir, fileName);
}

function deriveUploadName({
  tweetText,
  authorName,
  suggestedName,
}: {
  tweetText?: string;
  authorName?: string;
  suggestedName?: string;
}) {
  const rawTitle =
    suggestedName ||
    tweetText?.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 2).join(" ") ||
    "x-video";
  const uploader = suggestedName ? "" : authorName || "";
  const baseName = uploader ? `${uploader} - ${rawTitle}` : rawTitle;

  return sanitizeFileName(baseName);
}

async function getDestinationFolder(
  drive: drive_v3.Drive,
  folderId: string,
) {
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType,driveId,capabilities(canAddChildren,canEdit)",
      supportsAllDrives: true,
    });

    return response.data;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not access the configured Google Drive folder.";
    throw new Error(`Could not access GOOGLE_DRIVE_FOLDER_ID: ${message}`);
  }
}

function assertWritableDestination(
  folder: drive_v3.Schema$File,
  authMode: DriveAuthMode,
) {
  if (folder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID must point to a Google Drive folder.");
  }

  if (folder.capabilities?.canAddChildren === false || folder.capabilities?.canEdit === false) {
    throw new Error("The configured Google Drive folder is not writable by the authenticated account.");
  }

  if (authMode === "service-account" && !folder.driveId) {
    throw new Error(
      "This folder is inside My Drive. Service accounts cannot upload into My Drive because they have no storage quota. Use a Shared Drive folder or configure OAuth user credentials instead.",
    );
  }
}

export async function POST(request: Request) {
  let tempDir = "";

  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
    if (!folderId) {
      return jsonError("Missing GOOGLE_DRIVE_FOLDER_ID in env.", 500);
    }

    const body = (await request.json()) as UploadBody;
    const rawTweetUrl = typeof body.tweetUrl === "string" ? body.tweetUrl.trim() : "";
    const tweetText = typeof body.tweetText === "string" ? body.tweetText.trim() : "";
    const authorName = typeof body.authorName === "string" ? body.authorName.trim() : "";
    const suggestedName =
      typeof body.suggestedName === "string" ? body.suggestedName.trim() : "";
    const tweetUrl = normalizeTweetUrl(rawTweetUrl);

    if (!/^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(tweetUrl)) {
      return jsonError("Provide a valid X or Twitter URL.", 400);
    }

    const { drive, authMode } = createDriveClient();
    const destinationFolder = await getDestinationFolder(drive, folderId);
    assertWritableDestination(destinationFolder, authMode);

    tempDir = mkdtempSync(path.join(os.tmpdir(), "x-master-drive-video-"));

    const downloadedFilePath = await downloadVideo(tweetUrl, tempDir);
    const ext = path.extname(downloadedFilePath) || ".mp4";
    const uploadName = `${deriveUploadName({ tweetText, authorName, suggestedName })}${ext}`;

    const upload = await drive.files.create({
      requestBody: {
        name: uploadName,
        parents: [folderId],
      },
      media: {
        mimeType: extToMimeType(ext),
        body: createReadStream(downloadedFilePath),
      },
      fields: "id,name,webViewLink,webContentLink",
      supportsAllDrives: true,
    });

    return json({
      ok: true,
      file: {
        id: upload.data.id,
        name: upload.data.name,
        webViewLink: upload.data.webViewLink,
        webContentLink: upload.data.webContentLink,
      },
    });
  } catch (error) {
    return jsonError("Could not save X video to Google Drive.", 500, error);
  } finally {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
