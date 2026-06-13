import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  getChromaSetupHelp,
  parseEnvFile,
  resolveChromaDataPath,
  resolveChromaExecutable,
  resolveChromaHost,
  resolveChromaPort,
} from "./chroma-utils.mjs";

async function main() {
  const envFile = parseEnvFile(path.resolve(".env.local"));
  const chromaExecutable = resolveChromaExecutable(envFile);
  const chromaHost = resolveChromaHost(envFile);
  const chromaPort = resolveChromaPort(envFile);
  const chromaPath = resolveChromaDataPath(envFile);

  if (!chromaExecutable) {
    throw new Error(`Could not find the Chroma executable. ${getChromaSetupHelp()}`);
  }

  const child = spawn(
    chromaExecutable,
    ["run", "--path", chromaPath, "--host", chromaHost, "--port", String(chromaPort)],
    {
      stdio: "inherit",
      windowsHide: true,
    },
  );

  child.on("error", (error) => {
    console.error(
      `Could not start Chroma (${error instanceof Error ? error.message : String(error)}). ${getChromaSetupHelp()}`,
    );
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
