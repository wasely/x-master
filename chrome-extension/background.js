const MENU_ID = "x-master-save-tweet";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add tweet to database",
    contexts: ["all"],
    documentUrlPatterns: ["https://twitter.com/*", "https://x.com/*"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  const { appUrl = "http://localhost:3000" } = await chrome.storage.sync.get("appUrl");

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
    notify("Saved!", `${label} added to your database.`, true);
  } catch {
    notify("Connection error", `Could not reach X Master App at ${appUrl}. Is it running?`);
  }
});

function notify(title, message, ok = false) {
  chrome.notifications.create({
    type: "basic",
    title: `X Master: ${title}`,
    message,
  });
  // Badge gives instant visual feedback even if notifications are muted
  chrome.action.setBadgeText({ text: ok ? "✓" : "✗" });
  chrome.action.setBadgeBackgroundColor({ color: ok ? "#10b981" : "#ef4444" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}
