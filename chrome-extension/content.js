let lastTarget = null;

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
