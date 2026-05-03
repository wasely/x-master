import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

async function waitForPort(host, port, timeoutMs = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(host, port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function resolveCloudflaredPath() {
  const candidates = [
    process.env.CLOUDFLARED_PATH,
    path.resolve("tools", "cloudflared.exe"),
    path.resolve("tools", "cloudflared"),
  ].filter(Boolean);

  const match = candidates.find((candidate) => existsSync(candidate));
  if (match) return match;

  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

function resolveDevEntry() {
  return path.resolve("scripts", "dev.mjs");
}

async function main() {
  const envFile = parseEnvFile(path.resolve(".env.local"));
  const port = Number(process.env.PORT ?? envFile.PORT ?? "3000");
  const host = "127.0.0.1";
  const cloudflaredPath = resolveCloudflaredPath();
  const runtimeDir = path.resolve(".public-runtime");
  const urlFile = path.join(runtimeDir, "tunnel-url.txt");
  const pidFile = path.join(runtimeDir, "dev-public.pid");

  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(pidFile, String(process.pid), "utf8");

  let devProcess = null;
  let tunnelProcess = null;
  let shuttingDown = false;

  const serverAlreadyRunning = await isPortOpen(host, port);

  if (!serverAlreadyRunning) {
    devProcess = spawn(process.execPath, [resolveDevEntry()], {
      stdio: "inherit",
      windowsHide: true,
    });

    const ready = await waitForPort(host, port, 45000);
    if (!ready) {
      throw new Error(`App did not become reachable at http://${host}:${port}.`);
    }
  }

  writeFileSync(urlFile, "", "utf8");

  tunnelProcess = spawn(cloudflaredPath, ["tunnel", "--url", `http://${host}:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (tunnelProcess && !tunnelProcess.killed) {
      tunnelProcess.kill();
    }

    if (devProcess && !serverAlreadyRunning && !devProcess.killed) {
      devProcess.kill();
    }

    process.exit(code);
  };

  const onTunnelOutput = (chunk) => {
    const text = String(chunk);
    process.stdout.write(text);

    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      writeFileSync(urlFile, match[0], "utf8");
      process.stdout.write(`\nPublic URL: ${match[0]}\n`);
    }
  };

  tunnelProcess.stdout.on("data", onTunnelOutput);
  tunnelProcess.stderr.on("data", onTunnelOutput);

  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));

  tunnelProcess.on("exit", (code) => {
    shutdown(code ?? 0);
  });

  if (devProcess) {
    devProcess.on("exit", (code) => {
      if (!shuttingDown && !serverAlreadyRunning) {
        shutdown(code ?? 0);
      }
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
