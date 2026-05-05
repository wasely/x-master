let lastTarget = null;
const DRIVE_MESSAGE_TYPE = "SAVE_X_VIDEO_TO_DRIVE";
const DRIVE_BUTTON_ATTR = "data-x-master-drive-button";

document.addEventListener("contextmenu", (event) => {
  lastTarget = event.target;
}, true);

function closestTweetArticle(el) {
  while (el && el !== document.body) {
    if (el.matches && el.matches('article[data-testid="tweet"]')) return el;
    el = el.parentElement;
  }
  return null;
}

function cleanText(raw) {
  return (raw || "")
    .replace(/\s*https?:\/\/t\.co\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getAuthorFromPage() {
  const el = document.querySelector(
    '[data-testid="User-Name"], [data-testid="UserName"]'
  );
  return el?.querySelector("span")?.innerText?.trim() ?? "";
}

function extractFromTweetArticle(article) {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const tweetText = textEl ? cleanText(textEl.innerText) : "";

  // Collect ALL block-level text inside the article element
  const blocks = Array.from(
    article.querySelectorAll("h1,h2,h3,h4,p,li,blockquote")
  )
    .map((n) => n.innerText.trim())
    .filter(Boolean);
  const deduped = blocks.filter((line, i) => i === 0 || line !== blocks[i - 1]);
  const fullText = cleanText(deduped.join("\n\n"));

  // Use the richer version — if the full extraction is at least 2x longer than
  // the tweetText preview, the element contains an article body, so use that.
  const text = fullText.length > tweetText.length * 2 + 100 ? fullText : tweetText;

  const timeAnchor = article.querySelector("a[href*='/status/']");
  const rawHref = timeAnchor?.getAttribute("href") ?? "";
  const tweetUrl = rawHref
    ? rawHref.startsWith("http") ? rawHref : `https://x.com${rawHref}`
    : window.location.href;

  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const authorName =
    userNameEl?.querySelector("span")?.innerText?.trim() || getAuthorFromPage();

  return { text, tweetUrl, authorName };
}

function getVideoHost(article) {
  const player =
    article.querySelector('[data-testid="videoPlayer"]') ||
    article.querySelector('[data-testid="videoComponent"]');

  if (player) return player;

  const video = article.querySelector("video");
  if (!video) return null;

  return video.parentElement || video;
}

function buildSuggestedName(text, authorName) {
  const title = cleanText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .slice(0, 100);

  if (authorName && title) return `${authorName} - ${title}`;
  return title || authorName || "x-video";
}

function extractVideoDataFromArticle(article) {
  const tweetData = extractFromTweetArticle(article);

  return {
    tweetUrl: tweetData.tweetUrl,
    tweetText: tweetData.text,
    authorName: tweetData.authorName,
    suggestedName: buildSuggestedName(tweetData.text, tweetData.authorName),
  };
}

function setButtonState(button, label, disabled) {
  button.textContent = label;
  button.disabled = disabled;
  button.style.opacity = disabled ? "0.75" : "1";
}

function installDriveButton(article) {
  if (article.querySelector(`[${DRIVE_BUTTON_ATTR}]`)) return;

  const host = getVideoHost(article);
  if (!host) return;

  const computed = window.getComputedStyle(host);
  if (computed.position === "static") {
    host.style.position = "relative";
  }

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(DRIVE_BUTTON_ATTR, "1");
  button.textContent = "Drive";
  button.title = "Save video to Google Drive";
  Object.assign(button.style, {
    position: "absolute",
    top: "12px",
    right: "12px",
    zIndex: "2147483646",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: "999px",
    background: "rgba(15,15,15,0.88)",
    color: "#ffffff",
    fontSize: "12px",
    fontWeight: "600",
    lineHeight: "1",
    padding: "9px 12px",
    cursor: "pointer",
    backdropFilter: "blur(10px)",
    boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const payload = extractVideoDataFromArticle(article);
    if (!payload.tweetUrl) {
      setButtonState(button, "No URL", true);
      window.setTimeout(() => setButtonState(button, "Drive", false), 1800);
      return;
    }

    setButtonState(button, "Downloading...", true);
    showToast("Starting Drive save...");

    chrome.runtime.sendMessage({ type: DRIVE_MESSAGE_TYPE, payload }, (response) => {
      const errorMessage = chrome.runtime.lastError?.message || response?.error;
      if (errorMessage || !response?.ok) {
        showToast(errorMessage || "Could not save video to Google Drive.");
        setButtonState(button, "Retry", false);
        window.setTimeout(() => setButtonState(button, "Drive", false), 2200);
        return;
      }

      showToast(
        response?.file?.name
          ? `Saved to Google Drive: ${response.file.name}`
          : "Saved to Google Drive.",
      );
      setButtonState(button, "Saved", true);
      window.setTimeout(() => setButtonState(button, "Drive", false), 2200);
    });
  });

  host.appendChild(button);
}

function refreshDriveButtons(root) {
  const articles = new Set();

  if (root?.matches?.('article[data-testid="tweet"]')) {
    articles.add(root);
  }

  const closestArticle = root?.closest?.('article[data-testid="tweet"]');
  if (closestArticle) {
    articles.add(closestArticle);
  }

  root
    ?.querySelectorAll?.('article[data-testid="tweet"]')
    ?.forEach((article) => articles.add(article));

  articles.forEach((article) => {
    installDriveButton(article);
  });
}

// Fallback for pages with no tweet card — walks up from right-click target
function extractFromArticleContext(target) {
  const SKIP = new Set(["NAV", "HEADER", "FOOTER", "ASIDE", "SCRIPT", "STYLE"]);

  let el = target;
  let best = null;
  let bestLen = 0;

  while (el && el !== document.body) {
    if (!SKIP.has(el.tagName)) {
      const len = (el.innerText ?? "").trim().length;
      if (len > bestLen && len > 400) {
        best = el;
        bestLen = len;
      }
    }
    el = el.parentElement;
  }

  if (!best) return null;

  const parts = Array.from(
    best.querySelectorAll("h1,h2,h3,h4,p,li,blockquote")
  )
    .map((n) => n.innerText.trim())
    .filter(Boolean);
  const deduped = parts.filter((line, i) => i === 0 || line !== parts[i - 1]);
  const text = cleanText(deduped.length ? deduped.join("\n\n") : best.innerText);

  if (!text) return null;
  return { text, tweetUrl: window.location.href, authorName: getAuthorFromPage() };
}

function waitForElement(selector, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) { resolve(existing); return; }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
  });
}

function showToast(msg) {
  const existing = document.getElementById("xm-toast");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.id = "xm-toast";
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "88px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    background: "rgba(15,15,15,0.95)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "500",
    padding: "10px 18px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function openTwitterCompose(text) {
  // Click X's compose button
  const composeBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
  if (!composeBtn) {
    return { error: "Could not find the compose button. Make sure you are on X.com." };
  }
  composeBtn.click();

  // Wait for the compose editor (contentEditable div)
  const editor = await waitForElement('[data-testid="tweetTextarea_0"]', 4000);
  if (!editor) {
    return { error: "Compose box did not open in time." };
  }

  // Focus and insert text using execCommand so React picks it up
  editor.focus();
  document.execCommand("selectAll", false);
  document.execCommand("insertText", false, text);

  showToast("Close this compose window to save as X draft ✓");
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OPEN_TWITTER_COMPOSE") {
    openTwitterCompose(message.text).then(sendResponse);
    return true; // keep channel open for async response
  }

  if (message.type !== "GET_TWEET_DATA") return;

  // 1. Right-clicked inside a tweet card
  const tweetArticle = lastTarget && closestTweetArticle(lastTarget);
  if (tweetArticle) {
    sendResponse({ data: extractFromTweetArticle(tweetArticle) });
    return;
  }

  // 2. No tweet card — try article/long-form context
  if (lastTarget) {
    const ctx = extractFromArticleContext(lastTarget);
    if (ctx && ctx.text.length > 80) {
      sendResponse({ data: ctx });
      return;
    }
  }

  // 3. Fallback: any tweet card on the page
  const anyTweet = document.querySelector('article[data-testid="tweet"]');
  if (anyTweet) {
    sendResponse({ data: extractFromTweetArticle(anyTweet) });
    return;
  }

  sendResponse({ error: "Could not find any content to save on this page." });
});

let pendingRefresh = false;

function scheduleDriveRefresh(root = document) {
  if (pendingRefresh) return;
  pendingRefresh = true;

  window.requestAnimationFrame(() => {
    pendingRefresh = false;
    refreshDriveButtons(root);
  });
}

scheduleDriveRefresh(document);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type !== "childList") continue;
    mutation.addedNodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        scheduleDriveRefresh(node);
      }
    });
  }
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
}
