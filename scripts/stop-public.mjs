import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const pidFile = path.resolve(".public-runtime", "dev-public.pid");

if (!existsSync(pidFile)) {
  console.error("No saved public tunnel pid was found.");
  process.exit(1);
}

const pid = Number(readFileSync(pidFile, "utf8").trim());

if (!Number.isFinite(pid) || pid <= 0) {
  console.error("The saved public tunnel pid is invalid.");
  process.exit(1);
}

if (process.platform === "win32") {
  const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "inherit",
    windowsHide: true,
  });

  process.exit(result.status ?? 0);
}

try {
  process.kill(pid, "SIGTERM");
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
