const MENU_ID = "x-master-save-tweet";
const DRAFT_MENU_ID = "x-master-save-draft";
const TWITTER_DRAFT_MENU_ID = "x-master-to-twitter-draft";
const DRIVE_VIDEO_MESSAGE = "SAVE_X_VIDEO_TO_DRIVE";
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
      title: "Save as my draft",
      contexts: ["all"],
      documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"],
    });
    chrome.contextMenus.create({
      id: TWITTER_DRAFT_MENU_ID,
      title: "Save to X drafts",
      contexts: ["all"],
      documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"],
    });
  });
});

// Tries each localhost port until one responds, caches the winner.
async function findAppUrl() {
  const { appUrl } = await chrome.storage.sync.get("appUrl");

  // Try the cached URL first
  if (appUrl) {
    try {
      const res = await fetch(`${appUrl}/api/drafts`, { method: "OPTIONS", signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 204 || res.status === 405) return appUrl;
    } catch { /* fall through */ }
  }

  // Scan all ports
  for (const port of PORTS) {
    const url = `http://localhost:${port}`;
    if (url === appUrl) continue; // already tried
    try {
      const res = await fetch(`${url}/api/drafts`, { method: "OPTIONS", signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 204 || res.status === 405) {
        await chrome.storage.sync.set({ appUrl: url });
        return url;
      }
    } catch { /* keep scanning */ }
  }

  return null;
}

async function saveVideoToDrive(tweetData) {
  const appUrl = await findAppUrl();
  if (!appUrl) {
    throw new Error("Could not find X Master App on localhost 3000-3003. Is it running?");
  }

  const res = await fetch(`${appUrl}/api/drive/upload-x-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tweetData),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Server returned ${res.status}.`);
  }

  return data;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (
    info.menuItemId !== MENU_ID &&
    info.menuItemId !== DRAFT_MENU_ID &&
    info.menuItemId !== TWITTER_DRAFT_MENU_ID
  ) return;
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

  const { text, tweetUrl, authorName } = tweetData ?? {};
  if (!text && !tweetUrl) {
    notify("Nothing to save", "Could not extract any tweet content.");
    return;
  }

  const appUrl = await findAppUrl();
  if (!appUrl) {
    notify("App not found", "Could not find X Master App on localhost 3000–3003. Is it running?");
    return;
  }

  if (info.menuItemId === DRAFT_MENU_ID) {
    try {
      const res = await fetch(`${appUrl}/api/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text || tweetUrl, sourceUrl: tweetUrl, authorName }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        notify("Save failed", data.error ?? `Server returned ${res.status}.`);
        return;
      }

      const label = authorName ? `@${authorName}` : "Tweet";
      notify("Draft saved!", `${label}'s tweet is in your Drafts tab.`, true);
    } catch {
      notify("Connection error", `Could not reach X Master App at ${appUrl}.`);
    }
    return;
  }

  if (info.menuItemId === TWITTER_DRAFT_MENU_ID) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "OPEN_TWITTER_COMPOSE",
        text: text || "",
      });
      if (response?.error) {
        notify("Compose failed", response.error);
      }
    } catch {
      notify("Extension error", "Could not open compose box. Try reloading the tab.");
    }
    return;
  }

  try {
    const res = await fetch(`${appUrl}/api/tweets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: tweetUrl || text,
        tweetText: tweetUrl && text ? text : undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      notify("Save failed", data.error ?? `Server returned ${res.status}.`);
      return;
    }

    const label = authorName ? `@${authorName}` : "Tweet";
    notify("Saved!", `${label} added to your style library.`, true);
  } catch {
    notify("Connection error", `Could not reach X Master App at ${appUrl}.`);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== DRIVE_VIDEO_MESSAGE) return undefined;

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
});

function notify(title, message, ok = false) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon.svg"),
    title: `X Master: ${title}`,
    message,
  });
  chrome.action.setBadgeText({ text: ok ? "✓" : "✗" });
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#10b981" : "#ef4444" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}
