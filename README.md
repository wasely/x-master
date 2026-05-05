# X Master

A Next.js PWA for generating X-native posts. Save tweets to a local vector database, then generate new posts that match your personal writing style.

## Features

- **TikTok to X** - paste a TikTok URL or transcript and generate a post from the core idea
- **Generate** - write from any topic, guided by your saved style examples
- **Database** - browse, search, and manage your saved tweet library
- **Chrome extension** - right-click any tweet on X to save it directly to your database
- **X video to Drive** - click the Drive button on X videos to save them straight into Google Drive

## Stack

- **Next.js 14** (App Router) + TypeScript
- **ChromaDB** - local vector database for style references
- **OpenRouter** - AI generation (default: `google/gemini-2.5-flash-lite`)
- **Tailwind CSS**
- **Chrome Extension** (Manifest V3)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env.local`:

```env
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=google/gemini-2.5-flash-lite

# Optional - defaults shown
CHROMA_HOST=localhost
CHROMA_PORT=8000

# Optional - for one-click X video uploads to Google Drive
# If the folder is inside My Drive, use OAuth user credentials:
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
GOOGLE_DRIVE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_DRIVE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_DRIVE_REFRESH_TOKEN=your_google_oauth_refresh_token

# If the folder is inside a Shared Drive, you can use a service account instead:
# GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
# GOOGLE_DRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
# or GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_PATH
```

If you use the Drive uploader:

- For a folder inside **My Drive**, authenticate as the human Google account that owns the folder.
- For a folder inside a **Shared Drive**, share that Shared Drive with the service-account email.

To generate a refresh token for a My Drive folder after adding `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`, run:

```bash
npm run drive:auth
```

Use a Google OAuth client whose redirect URI includes `http://127.0.0.1:8787/oauth2callback` unless you override `GOOGLE_DRIVE_REDIRECT_URI`.

### 3. Start ChromaDB

ChromaDB must be running before you start the app. The path below is configurable - update `package.json` to match your install:

```bash
npm run chroma:run
```

### 4. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Chrome Extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `chrome-extension/` folder
4. Click the extension icon to confirm the App URL (default: `http://localhost:3000`)
5. Right-click any tweet on X -> **"Add tweet to database"**
6. On any X post with a video, click the **Drive** button overlay to send the video to your configured Drive folder

Important: Google Drive service accounts cannot upload into a user's **My Drive** because service accounts do not have storage quota. Use OAuth credentials for My Drive folders, or switch the destination to a Shared Drive.

## Project Structure

```text
app/
  api/
    chroma/health/        - ChromaDB health check
    convert/              - Legacy convert endpoint
    drafts/               - Local draft storage API
    drive/upload-x-video/ - Download an X video and upload it to Google Drive
    extract-captions/     - TikTok caption extraction via yt-dlp
    generate/             - AI content generation
    generate/feedback/    - Save liked/disliked generations to library
    tweets/               - CRUD for tweet style library
  database/               - Browse and manage saved examples
  drafts/                 - Draft management UI
  generate/               - Generate from a topic
  tiktok/                 - Convert TikTok to X post
chrome-extension/         - Chrome MV3 extension
components/               - Shared UI components
lib/
  chroma.ts               - ChromaDB client
  content-options.ts      - Length and feeling configuration
  generation.ts           - AI generation pipeline
  tweets.ts               - Tweet record types and helpers
public/                   - PWA icons and manifest
scripts/                  - Dev server helpers
```

## Requirements

- Node.js 18+
- [ChromaDB](https://docs.trychroma.com) running locally
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on PATH
- An [OpenRouter](https://openrouter.ai) API key
- A Google Drive folder shared with your service-account email if you want one-click video uploads
