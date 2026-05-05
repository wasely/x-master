import http from "node:http";
import { readFileSync } from "node:fs";
import process from "node:process";
import { google } from "googleapis";

function parseEnvFile(filePath) {
  try {
    const env = {};
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

      env[key] = value;
    }

    return env;
  } catch {
    return {};
  }
}

function getConfig() {
  const fileEnv = parseEnvFile(".env.local");
  const redirectUri =
    process.env.GOOGLE_DRIVE_REDIRECT_URI ||
    fileEnv.GOOGLE_DRIVE_REDIRECT_URI ||
    "http://127.0.0.1:8787/oauth2callback";
  const clientId =
    process.env.GOOGLE_DRIVE_CLIENT_ID ||
    fileEnv.GOOGLE_DRIVE_CLIENT_ID ||
    "";
  const clientSecret =
    process.env.GOOGLE_DRIVE_CLIENT_SECRET ||
    fileEnv.GOOGLE_DRIVE_CLIENT_SECRET ||
    "";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET. Add them to .env.local first.",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

async function main() {
  const { clientId, clientSecret, redirectUri } = getConfig();
  const redirectUrl = new URL(redirectUri);
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive"],
  });

  console.log("Open this URL in your browser and approve access:\n");
  console.log(authUrl);
  console.log("\nWaiting for Google OAuth callback on", redirectUri);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", redirectUri);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Google returned an error: ${error}\n`);
        console.error(`Google returned an error: ${error}`);
        server.close(() => process.exit(1));
        return;
      }

      if (!code) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Missing OAuth code.\n");
        return;
      }

      const { tokens } = await oauth2.getToken(code);
      const refreshToken = tokens.refresh_token;

      if (!refreshToken) {
        throw new Error(
          "Google did not return a refresh token. Re-run the script and approve with prompt=consent, or remove the app from your Google account permissions first.",
        );
      }

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Google Drive refresh token captured. Return to the terminal.\n");

      console.log("\nAdd this to .env.local:\n");
      console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${refreshToken}`);

      server.close(() => process.exit(0));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OAuth exchange failed. Check the terminal for details.\n");
      console.error(error instanceof Error ? error.message : String(error));
      server.close(() => process.exit(1));
    }
  });

  server.listen(Number(redirectUrl.port || "80"), redirectUrl.hostname);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
