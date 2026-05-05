import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const RUNTIME_DIR = path.resolve(".runtime");
const SERVER_INFO_PATH = path.join(RUNTIME_DIR, "dev-server.json");

function parseEnvFile(filePath) {
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

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });

    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function waitForPort(host, port, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(host, port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function resolveNextEntry() {
  return path.resolve("node_modules", "next", "dist", "bin", "next");
}

async function findAvailablePort(host, preferredPort, maxAttempts = 10) {
  let port = preferredPort;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!(await isPortOpen(host, port))) {
      return port;
    }

    port += 1;
  }

  throw new Error(
    `Could not find an open port starting at ${preferredPort}. Tried ${maxAttempts} ports.`,
  );
}

function resolveDistDir(port) {
  return `.next-dev-${port}`;
}

function writeServerInfo(info) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(SERVER_INFO_PATH, JSON.stringify(info, null, 2), "utf8");
}

function clearServerInfo() {
  rmSync(SERVER_INFO_PATH, { force: true });
}

function syncTypeScriptIncludes(tsConfigPath, distDir) {
  if (!existsSync(tsConfigPath)) return;

  try {
    const raw = readFileSync(tsConfigPath, "utf8");
    const config = JSON.parse(raw);

    if (!config || typeof config !== "object" || !Array.isArray(config.include)) {
      return;
    }

    const nextTypesEntry = `${distDir}/types/**/*.ts`;
    const previousDevEntries = /^\.next-dev-\d+\/types\/\*\*\/\*\.ts$/;
    const nextIndex = config.include.indexOf(".next/types/**/*.ts");
    const includes = config.include.filter(
      (entry) => typeof entry === "string" && !previousDevEntries.test(entry),
    );

    if (!includes.includes(nextTypesEntry)) {
      if (nextIndex >= 0 && nextIndex < includes.length) {
        includes.splice(nextIndex + 1, 0, nextTypesEntry);
      } else {
        includes.push(nextTypesEntry);
      }
    }

    if (JSON.stringify(config.include) === JSON.stringify(includes)) {
      return;
    }

    config.include = includes;
    writeFileSync(tsConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch {
    // Leave tsconfig untouched if it cannot be parsed as plain JSON.
  }
}

async function main() {
  const envFile = parseEnvFile(path.resolve(".env.local"));
  const appHost = "127.0.0.1";
  const preferredPort = Number(process.env.PORT ?? envFile.PORT ?? "3000");
  const appPort = await findAvailablePort(appHost, preferredPort);
  const distDir = resolveDistDir(appPort);
  const tsConfigPath = path.resolve("tsconfig.json");
  const chromaHost = process.env.CHROMA_HOST ?? envFile.CHROMA_HOST ?? "localhost";
  const chromaPort = Number(process.env.CHROMA_PORT ?? envFile.CHROMA_PORT ?? "8000");
  const chromaPath =
    process.env.CHROMA_PATH ?? envFile.CHROMA_PATH ?? "C:/Users/kaigu/chroma-data";
  const chromaExe =
    process.env.CHROMA_EXE ?? envFile.CHROMA_EXE ?? "C:/Users/kaigu/bin/chroma.exe";

  let chromaProcess = null;

  if (appPort !== preferredPort) {
    console.log(`Port ${preferredPort} is in use. Starting Next on ${appPort} instead.`);
  }

  rmSync(path.resolve(distDir), { recursive: true, force: true });
  syncTypeScriptIncludes(tsConfigPath, distDir);
  writeServerInfo({
    host: appHost,
    port: appPort,
    distDir,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  if (!(await isPortOpen(chromaHost, chromaPort))) {
    if (!existsSync(chromaExe)) {
      clearServerInfo();
      console.error(`Chroma binary not found at ${chromaExe}`);
      process.exit(1);
    }

    chromaProcess = spawn(
      chromaExe,
      ["run", "--path", chromaPath, "--host", chromaHost, "--port", String(chromaPort)],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );

    chromaProcess.on("exit", (code) => {
      if (code && code !== 0) {
        console.error(`Chroma exited with code ${code}.`);
      }
    });

    const ready = await waitForPort(chromaHost, chromaPort, 30000);
    if (!ready) {
      clearServerInfo();
      console.error(`Chroma did not become ready on ${chromaHost}:${chromaPort}.`);
      process.exit(1);
    }
  }

  console.log(`Using build directory ${distDir}.`);

  const nextProcess = spawn(
    process.execPath,
    [resolveNextEntry(), "dev", "--port", String(appPort)],
    {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(appPort),
        NEXT_DIST_DIR: distDir,
      },
    },
  );

  const shutdown = (code = 0) => {
    clearServerInfo();

    if (chromaProcess && !chromaProcess.killed) {
      chromaProcess.kill();
    }

    if (!nextProcess.killed) {
      nextProcess.kill();
    }

    process.exit(code);
  };

  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));

  nextProcess.on("exit", (code) => {
    shutdown(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
