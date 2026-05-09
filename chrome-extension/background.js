const MENU_ID = "x-master-save-tweet";
const DRAFT_MENU_ID = "x-master-save-draft";
const DRIVE_VIDEO_MESSAGE = "SAVE_X_VIDEO_TO_DRIVE";
const REPLY_GENERATION_MESSAGE = "GENERATE_TWEET_REPLY";
const DEFAULT_APP_URL = "https://x-master-peach.vercel.app";
const PORTS = [3000, 3001, 3002, 3003];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Add tweet to style library",
      contexts: ["all"],
      documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"],
    });
    chrome.contextMenus.create({
      id: DRAFT_MENU_ID,
      title: "Save tweet as draft",
      contexts: ["all"],
      documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"],
    });
  });
});

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function normalizeBypassToken(token) {
  return String(token || "").trim();
}

function withBypassHeaders(headers = {}, token = "") {
  const cleanToken = normalizeBypassToken(token);
  return {
    ...headers,
    ...(cleanToken ? { "x-vercel-protection-bypass": cleanToken } : {}),
  };
}

async function getConnectionSettings() {
  const [{ appUrl }, { vercelBypassToken }] = await Promise.all([
    chrome.storage.sync.get("appUrl"),
    chrome.storage.local.get("vercelBypassToken"),
  ]);

  return {
    appUrl: normalizeUrl(appUrl || DEFAULT_APP_URL),
    vercelBypassToken: normalizeBypassToken(vercelBypassToken),
  };
}

async function probeAppUrl(url, token) {
  try {
    const res = await fetch(`${url}/api/health`, {
      method: "GET",
      headers: withBypassHeaders({}, token),
      signal: AbortSignal.timeout(5000),
    });

    return ![401, 403, 404].includes(res.status);
  } catch {
    return false;
  }
}

async function findConnection() {
  const settings = await getConnectionSettings();
  const candidates = [
    settings.appUrl,
    DEFAULT_APP_URL,
    ...PORTS.map((port) => `http://localhost:${port}`),
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    if (await probeAppUrl(url, settings.vercelBypassToken)) {
      await chrome.storage.sync.set({ appUrl: url });
      return { appUrl: url, vercelBypassToken: settings.vercelBypassToken };
    }
  }

  return null;
}

async function fetchAppJson(path, payload) {
  const connection = await findConnection();
  if (!connection) {
    throw new Error("Could not reach X Master. Check the hosted URL or Vercel bypass token.");
  }

  const res = await fetch(`${connection.appUrl}${path}`, {
    method: "POST",
    headers: withBypassHeaders({ "Content-Type": "application/json" }, connection.vercelBypassToken),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Server returned ${res.status}.`);
  }

  return data;
}

async function saveVideoToDrive(tweetData) {
  return fetchAppJson("/api/drive/upload-x-video", tweetData);
}

async function generateTweetReply(payload) {
  return fetchAppJson("/api/extension/generate-reply", payload);
}

function normalizeHandle(value) {
  const clean = String(value ?? "").trim().replace(/^@/, "");
  return /^[a-zA-Z0-9_]{1,15}$/.test(clean) ? clean : "";
}

function formatAuthorLabel(authorName, authorHandle) {
  const handle = normalizeHandle(authorHandle);
  const handleLabel = handle ? `@${handle}` : "";
  const cleanName = String(authorName ?? "").trim();
  const nameAsHandle = normalizeHandle(cleanName);

  if (handleLabel && nameAsHandle === handle) {
    return handleLabel;
  }

  if (cleanName && handleLabel && cleanName !== handleLabel) {
    return `${cleanName} (${handleLabel})`;
  }

  return cleanName || handleLabel || "Tweet";
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID && info.menuItemId !== DRAFT_MENU_ID) return;
  if (!tab?.id) return;

  let tweetData;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_TWEET_DATA" });
    if (response?.error) {
      notify("Could not find tweet", response.error);
      return;
    }
    tweetData = response?.data;
  } catch {
    notify("Extension error", "Could not communicate with the page. Try reloading the tab.");
    return;
  }

  const { text, tweetUrl, authorName, authorHandle } = tweetData ?? {};
  if (!text && !tweetUrl) {
    notify("Nothing to save", "Could not extract any tweet content.");
    return;
  }

  const connection = await findConnection();
  if (!connection) {
    notify("App not found", "Check the hosted URL or Vercel bypass token in the extension popup.");
    return;
  }

  if (info.menuItemId === DRAFT_MENU_ID) {
    try {
      const res = await fetch(`${connection.appUrl}/api/drafts`, {
        method: "POST",
        headers: withBypassHeaders({ "Content-Type": "application/json" }, connection.vercelBypassToken),
        body: JSON.stringify({ text: text || tweetUrl, sourceUrl: tweetUrl, authorName, authorHandle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify("Save failed", data.error ?? `Server returned ${res.status}.`);
        return;
      }
    } catch {
      notify("Connection error", `Could not reach X Master at ${connection.appUrl}.`);
      return;
    }

    const label = formatAuthorLabel(authorName, authorHandle);
    try {
      const xResponse = await chrome.tabs.sendMessage(tab.id, {
        type: "SAVE_TO_X_DRAFT",
        text: text || "",
      });
      if (xResponse?.ok) {
        notify("Draft saved", `${label}'s tweet is in your Drafts and ready in X.`, true);
      } else {
        notify("Partially saved", `Saved to your Drafts. X draft: ${xResponse?.error ?? "failed"}.`, true);
      }
    } catch {
      notify("Partially saved", `${label}'s tweet saved to your Drafts. Could not save to X drafts.`, true);
    }
    return;
  }

  try {
    const res = await fetch(`${connection.appUrl}/api/tweets`, {
      method: "POST",
      headers: withBypassHeaders({ "Content-Type": "application/json" }, connection.vercelBypassToken),
      body: JSON.stringify({
        input: tweetUrl || text,
        tweetText: tweetUrl && text ? text : undefined,
        authorName,
        authorHandle,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      notify("Save failed", data.error ?? `Server returned ${res.status}.`);
      return;
    }

    const label = formatAuthorLabel(authorName, authorHandle);
    notify("Saved", `${label} added to your style library.`, true);
  } catch {
    notify("Connection error", `Could not reach X Master at ${connection.appUrl}.`);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === DRIVE_VIDEO_MESSAGE) {
    saveVideoToDrive(message.payload)
      .then((data) => {
        notify("Video saved", data?.file?.name ?? "Saved to Google Drive.", true);
        sendResponse({ ok: true, file: data?.file ?? null });
      })
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : "Could not save the video.";
        notify("Video save failed", messageText);
        sendResponse({ ok: false, error: messageText });
      });

    return true;
  }

  if (message?.type === REPLY_GENERATION_MESSAGE) {
    generateTweetReply(message.payload)
      .then((data) => {
        sendResponse({ ok: true, ...data });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not generate a reply.",
        });
      });

    return true;
  }

  return undefined;
});

function notify(title, message, ok = false) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: `X Master: ${title}`,
    message,
  });
  chrome.action.setBadgeText({ text: ok ? "OK" : "!" });
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#10b981" : "#ef4444" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}
