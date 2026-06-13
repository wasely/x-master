import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_CHROMA_HOST = "localhost";
const DEFAULT_CHROMA_PORT = 8000;
const DEFAULT_CHROMA_DIR = path.resolve(".runtime", "chroma");

export function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const output = {};
  const contents = readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    output[key] = value;
  }

  return output;
}

function commandLooksLikePath(command) {
  return /^[a-zA-Z]:[\\/]/.test(command) || command.includes("/") || command.includes("\\");
}

export function resolveChromaHost(envFile = {}) {
  return process.env.CHROMA_HOST ?? envFile.CHROMA_HOST ?? DEFAULT_CHROMA_HOST;
}

export function resolveChromaPort(envFile = {}) {
  return Number(process.env.CHROMA_PORT ?? envFile.CHROMA_PORT ?? DEFAULT_CHROMA_PORT);
}

export function resolveChromaDataPath(envFile = {}) {
  return process.env.CHROMA_PATH ?? envFile.CHROMA_PATH ?? DEFAULT_CHROMA_DIR;
}

export function resolveChromaExecutable(envFile = {}) {
  const defaultBinary = process.platform === "win32" ? "chroma.exe" : "chroma";
  const bundledBinary = path.resolve("tools", defaultBinary);
  const candidates = [
    process.env.CHROMA_EXE,
    envFile.CHROMA_EXE,
    existsSync(bundledBinary) ? bundledBinary : null,
    defaultBinary,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!commandLooksLikePath(candidate) || existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getChromaSetupHelp() {
  return [
    "Install the Chroma CLI so `chroma` is available on PATH,",
    "or set CHROMA_EXE in `.env.local` or your shell.",
    "Optional: set CHROMA_PATH to choose where local data is stored.",
  ].join(" ");
}
