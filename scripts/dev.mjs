import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";

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

async function main() {
  const envFile = parseEnvFile(path.resolve(".env.local"));
  const chromaHost = process.env.CHROMA_HOST ?? envFile.CHROMA_HOST ?? "localhost";
  const chromaPort = Number(process.env.CHROMA_PORT ?? envFile.CHROMA_PORT ?? "8000");
  const chromaPath =
    process.env.CHROMA_PATH ?? envFile.CHROMA_PATH ?? "C:/Users/kaigu/chroma-data";
  const chromaExe =
    process.env.CHROMA_EXE ?? envFile.CHROMA_EXE ?? "C:/Users/kaigu/bin/chroma.exe";

  let chromaProcess = null;

  if (!(await isPortOpen(chromaHost, chromaPort))) {
    if (!existsSync(chromaExe)) {
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
      console.error(`Chroma did not become ready on ${chromaHost}:${chromaPort}.`);
      process.exit(1);
    }
  }

  const nextProcess = spawn(process.execPath, [resolveNextEntry(), "dev"], {
    stdio: "inherit",
    windowsHide: true,
  });

  const shutdown = (code = 0) => {
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
