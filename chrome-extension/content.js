const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';
const USER_NAME_SELECTOR = '[data-testid="User-Name"], [data-testid="UserName"]';
const X_COMPOSE_SELECTOR = '[data-testid="tweetTextarea_0"]';
const X_COMPOSE_EDITABLE_SELECTOR = [
  '[data-testid="tweetTextarea_0"][contenteditable="true"]',
  '[data-testid="tweetTextarea_0"] [contenteditable="true"]',
  '[data-testid="tweetTextarea_0"] div[role="textbox"]',
  '[contenteditable="true"][role="textbox"]',
].join(", ");

const DRIVE_MESSAGE_TYPE = "SAVE_X_VIDEO_TO_DRIVE";
const REPLY_GENERATION_MESSAGE = "GENERATE_TWEET_REPLY";
const DRIVE_BUTTON_ATTR = "data-x-master-drive-button";
const REPLY_BUTTON_ATTR = "data-x-master-reply-button";
const REPLY_PANEL_ID = "xm-reply-panel";
const REPLY_TONE_KEY = "extensionReplyToneId";
const REPLY_LENGTH_KEY = "extensionReplyLengthId";

const LENGTH_OPTIONS = [
  { id: "one_liner", label: "One-liner" },
  { id: "short_post", label: "Short post" },
  { id: "regular_post", label: "Regular post" },
];

const TONE_OPTIONS = [
  { id: "persuasive", label: "Persuasive" },
  { id: "funny", label: "Funny" },
  { id: "calm", label: "Calm" },
  { id: "relax", label: "Relax" },
  { id: "just_typing", label: "Just typing" },
];

let lastTarget = null;
let activeReplyPanel = null;
let pendingRefresh = false;

document.addEventListener(
  "contextmenu",
  (event) => {
    lastTarget = event.target;
  },
  true,
);

document.addEventListener(
  "pointerdown",
  (event) => {
    if (!activeReplyPanel) return;

    const target = event.target;
    if (!(target instanceof Node)) return;

    if (
      activeReplyPanel.panel.contains(target) ||
      activeReplyPanel.button.contains(target)
    ) {
      return;
    }

    closeReplyPanel();
  },
  true,
);

window.addEventListener(
  "scroll",
  () => {
    if (activeReplyPanel) closeReplyPanel();
  },
  true,
);

window.addEventListener("resize", () => {
  if (activeReplyPanel) closeReplyPanel();
  scheduleButtonRefresh(document);
});

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function cleanText(raw) {
  return (raw || "")
    .replace(/\s*https?:\/\/t\.co\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeHandle(value) {
  const clean = String(value ?? "").trim().replace(/^@/, "");
  return /^[a-zA-Z0-9_]{1,15}$/.test(clean) ? clean : "";
}

function mentionFromText(value) {
  const clean = String(value ?? "").trim();
  return clean.startsWith("@") ? normalizeHandle(clean) : "";
}

function handleFromStatusUrl(value) {
  if (!value) return "";

  try {
    const parsed = new URL(value, window.location.origin);
    const [handle, segment] = parsed.pathname.split("/").filter(Boolean);
    if (segment !== "status") return "";
    return normalizeHandle(handle);
  } catch {
    return "";
  }
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

  return cleanName || handleLabel || "this tweet";
}

function closestTweetArticle(element) {
  let current = element;

  while (current && current !== document.body) {
    if (current.matches && current.matches(ARTICLE_SELECTOR)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function getTextParts(root) {
  if (!root) return [];

  return Array.from(root.querySelectorAll("span"))
    .map((node) => cleanText(node.innerText))
    .filter(Boolean);
}

function getIdentityFromUserBlock(userBlock, tweetUrl) {
  const parts = getTextParts(userBlock);
  const handle =
    handleFromStatusUrl(tweetUrl) ||
    parts.map(mentionFromText).find(Boolean) ||
    "";
  const displayName =
    parts.find((part) => {
      if (mentionFromText(part)) return false;
      if (/^[·•]$/.test(part)) return false;
      if (/^(follow|following|subscribe|verified)$/i.test(part)) return false;
      return true;
    }) ?? "";

  return {
    authorName: displayName,
    authorHandle: handle,
  };
}

function getAuthorFromPage() {
  return getIdentityFromUserBlock(document.querySelector(USER_NAME_SELECTOR), window.location.href);
}

function getTweetStatusUrl(article) {
  const anchors = Array.from(article.querySelectorAll('a[href*="/status/"]'));
  const timeAnchor =
    anchors.find((anchor) => anchor.querySelector("time")) ?? anchors[0] ?? null;
  const href = timeAnchor?.getAttribute("href") ?? "";

  if (!href) return window.location.href;
  return href.startsWith("http") ? href : `https://x.com${href}`;
}

function extractFromTweetArticle(article) {
  const tweetTextElement = article.querySelector(TWEET_TEXT_SELECTOR);
  const text = tweetTextElement ? cleanText(tweetTextElement.innerText) : "";

  const userName = article.querySelector('[data-testid="User-Name"]');
  const tweetUrl = getTweetStatusUrl(article);
  const identity = getIdentityFromUserBlock(userName, tweetUrl);
  const pageIdentity = getAuthorFromPage();
  const authorName = identity.authorName || pageIdentity.authorName;
  const authorHandle = identity.authorHandle || pageIdentity.authorHandle;

  return { text, tweetUrl, authorName, authorHandle };
}

function getVideoHost(article) {
  const player =
    article.querySelector('[data-testid="videoPlayer"]') ||
    article.querySelector('[data-testid="videoComponent"]');

  if (player) return player;

  const video = article.querySelector("video");
  return video?.parentElement || video || null;
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
    authorHandle: tweetData.authorHandle,
    suggestedName: buildSuggestedName(tweetData.text, tweetData.authorName),
  };
}

function setButtonState(button, label, disabled) {
  button.textContent = label;
  button.disabled = disabled;
  button.style.opacity = disabled ? "0.75" : "1";
}

function showToast(message) {
  const existing = document.getElementById("xm-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "xm-toast";
  toast.textContent = message;
  Object.assign(toast.style, {
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

  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

function isVisibleElement(element) {
  if (!(element instanceof HTMLElement)) return false;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  return Boolean(
    element.offsetWidth ||
      element.offsetHeight ||
      element.getClientRects().length,
  );
}

function isEditableComposeTarget(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (!isVisibleElement(element)) return false;

  const role = element.getAttribute("role");
  const contentEditable = element.getAttribute("contenteditable");

  return (
    contentEditable === "true" ||
    role === "textbox" ||
    element.isContentEditable
  );
}

function getEditableComposeTarget(root) {
  if (!(root instanceof HTMLElement)) return null;

  if (isEditableComposeTarget(root)) {
    return root;
  }

  const nestedEditable = root.querySelector(X_COMPOSE_EDITABLE_SELECTOR);
  return nestedEditable instanceof HTMLElement && isEditableComposeTarget(nestedEditable)
    ? nestedEditable
    : null;
}

function getVisibleComposeEditors() {
  const directEditors = Array.from(
    document.querySelectorAll(X_COMPOSE_EDITABLE_SELECTOR),
  ).filter((node) => node instanceof HTMLElement && isEditableComposeTarget(node));

  if (directEditors.length) {
    return directEditors;
  }

  return Array.from(document.querySelectorAll(X_COMPOSE_SELECTOR))
    .map((node) => getEditableComposeTarget(node))
    .filter((node) => node instanceof HTMLElement && isEditableComposeTarget(node));
}

function isElementWithinViewport(element) {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

function getComposeEditorScore(editor, previousEditors = new Set()) {
  const activeElement = document.activeElement;
  const hasUsefulActiveElement =
    activeElement instanceof HTMLElement &&
    activeElement !== document.body &&
    activeElement !== document.documentElement;
  const rect = editor.getBoundingClientRect();
  let score = 0;

  if (!previousEditors.has(editor)) score += 120;
  if (
    hasUsefulActiveElement &&
    (editor === activeElement || editor.contains(activeElement) || activeElement.contains(editor))
  ) {
    score += 90;
  }
  if (editor.closest('[role="dialog"]')) score += 30;
  if (isElementWithinViewport(editor)) score += 20;

  score += Math.max(0, Math.min(20, window.innerHeight - Math.abs(rect.top)));

  return score;
}

function pickBestComposeEditor(previousEditors = new Set(), allowPrevious = true) {
  const activeElement = document.activeElement;
  const hasUsefulActiveElement =
    activeElement instanceof HTMLElement &&
    activeElement !== document.body &&
    activeElement !== document.documentElement;
  const editors = getVisibleComposeEditors();
  const candidates = allowPrevious
    ? editors
    : editors.filter((editor) => {
        if (!previousEditors.has(editor)) return true;
        return (
          hasUsefulActiveElement &&
          (editor === activeElement || editor.contains(activeElement) || activeElement.contains(editor))
        );
      });

  return candidates
    .map((editor, index) => ({
      editor,
      index,
      score: getComposeEditorScore(editor, previousEditors),
    }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .at(-1)?.editor ?? null;
}

function findComposeEditor() {
  return pickBestComposeEditor(new Set(), true);
}

function waitForComposeEditor(previousEditors = new Set(), timeoutMs = 4000) {
  return new Promise((resolve) => {
    const pickNewOrFocusedEditor = () => pickBestComposeEditor(previousEditors, false);

    const existing = pickNewOrFocusedEditor();
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const editor = pickNewOrFocusedEditor();
      if (editor) {
        observer.disconnect();
        resolve(editor);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      observer.disconnect();
      resolve(pickBestComposeEditor(previousEditors, true));
    }, timeoutMs);
  });
}

function waitForElement(matcher, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const existing = matcher();
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const match = matcher();
      if (match) {
        observer.disconnect();
        resolve(match);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      observer.disconnect();
      resolve(matcher());
    }, timeoutMs);
  });
}

function getEditorPlainText(editor) {
  return (editor.innerText || editor.textContent || "").trim();
}

function normalizeComposerText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function editorContainsExpectedText(editor, expectedText) {
  return normalizeComposerText(getEditorPlainText(editor)) === normalizeComposerText(expectedText);
}

function selectEditorContents(editor) {
  editor.focus();

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function dispatchInputUpdate(editor, inputType, data) {
  editor.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType,
      data,
    }),
  );
}

function dispatchCompositionEvents(editor, inputType, data = "") {
  dispatchInputUpdate(editor, inputType, data);
  editor.dispatchEvent(new Event("change", { bubbles: true }));
  editor.dispatchEvent(
    new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key: " ",
      code: "Space",
    }),
  );
}

async function clearEditorContents(editor) {
  editor.focus();
  selectEditorContents(editor);

  try {
    document.execCommand("delete", false);
  } catch {
    // Fall through to direct DOM cleanup.
  }

  await sleep(40);

  if (normalizeComposerText(getEditorPlainText(editor))) {
    editor.textContent = "";
    dispatchCompositionEvents(editor, "deleteContentBackward");
    await sleep(60);
  }
}

async function insertViaPaste(editor, text) {
  if (
    typeof DataTransfer === "undefined" ||
    typeof ClipboardEvent === "undefined"
  ) {
    return false;
  }

  selectEditorContents(editor);

  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", text);

  const dispatched = editor.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    }),
  );

  await sleep(120);
  return dispatched && editorContainsExpectedText(editor, text);
}

async function insertViaExecCommand(editor, text) {
  await clearEditorContents(editor);
  selectEditorContents(editor);

  const inserted = document.execCommand("insertText", false, text);
  await sleep(120);

  if (inserted) {
    dispatchCompositionEvents(editor, "insertText", text);
  }

  return editorContainsExpectedText(editor, text);
}

async function insertViaLineCommands(editor, text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  await clearEditorContents(editor);
  selectEditorContents(editor);

  for (const [index, line] of lines.entries()) {
    if (line) {
      document.execCommand("insertText", false, line);
    }

    if (index < lines.length - 1) {
      document.execCommand("insertParagraph", false);
    }
  }

  dispatchCompositionEvents(editor, "insertText", text);
  await sleep(140);
  return editorContainsExpectedText(editor, text);
}

async function insertViaDirectDom(editor, text) {
  await clearEditorContents(editor);
  editor.focus();
  editor.textContent = text;
  dispatchCompositionEvents(editor, "insertText", text);
  await sleep(160);
  return editorContainsExpectedText(editor, text);
}

async function waitForInsertedText(editor, text, timeoutMs = 700) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (editorContainsExpectedText(editor, text)) return true;
    await sleep(60);
  }

  return editorContainsExpectedText(editor, text);
}

async function replaceComposeText(editor, text) {
  const strategies = [
    insertViaPaste,
    insertViaExecCommand,
    insertViaLineCommands,
    insertViaDirectDom,
  ];

  for (const strategy of strategies) {
    editor.focus();
    const inserted = await strategy(editor, text);

    if (inserted || (await waitForInsertedText(editor, text))) {
      return { ok: true, text: getEditorPlainText(editor) };
    }
  }

  const refreshedEditor = findComposeEditor();
  if (refreshedEditor && refreshedEditor !== editor) {
    for (const strategy of [insertViaExecCommand, insertViaLineCommands, insertViaDirectDom]) {
      const inserted = await strategy(refreshedEditor, text);

      if (inserted || (await waitForInsertedText(refreshedEditor, text))) {
        return { ok: true, text: getEditorPlainText(refreshedEditor) };
      }
    }
  }

  return {
    ok: false,
    error: "Could not insert text into the X composer. Click inside the composer and try again.",
  };
}

async function openGlobalCompose(text) {
  const existingEditor = findComposeEditor();
  if (existingEditor) {
    return replaceComposeText(existingEditor, text);
  }

  const composeButton = document.querySelector(
    '[data-testid="SideNav_NewTweet_Button"]',
  );
  if (!(composeButton instanceof HTMLElement)) {
    return {
      ok: false,
      error: "Could not find the compose button. Make sure you are on X.com.",
    };
  }

  const previousEditors = new Set(getVisibleComposeEditors());
  composeButton.click();

  const editor = await waitForComposeEditor(previousEditors, 4000);
  if (!(editor instanceof HTMLElement)) {
    return { ok: false, error: "Compose box did not open in time." };
  }

  return replaceComposeText(editor, text);
}

async function insertReplyIntoTweet(article, text) {
  const replyButton =
    article.querySelector('[data-testid="reply"]') ||
    article.querySelector('button[aria-label^="Reply"]');

  const trigger =
    replyButton?.closest("button, a, div[role='button']") || replyButton;
  if (!(trigger instanceof HTMLElement)) {
    return { ok: false, error: "Could not find the reply button for this tweet." };
  }

  const previousEditors = new Set(getVisibleComposeEditors());
  trigger.click();

  const editor = await waitForComposeEditor(previousEditors, 5000);
  if (!(editor instanceof HTMLElement)) {
    return { ok: false, error: "Reply box did not open in time." };
  }

  await sleep(180);
  const inserted = await replaceComposeText(editor, text);
  if (!inserted.ok) {
    return inserted;
  }

  if (!getEditorPlainText(editor)) {
    return {
      ok: false,
      error: "Reply box opened, but X did not accept the generated text.",
    };
  }

  return { ok: true };
}

function installDriveButton(article) {
  if (article.querySelector(`[${DRIVE_BUTTON_ATTR}]`)) return;

  const host = getVideoHost(article);
  if (!host) return;

  if (window.getComputedStyle(host).position === "static") {
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

function findReplyButtonPlacement(article) {
  const menuButton =
    article.querySelector('[data-testid="caret"]') ||
    article.querySelector('button[aria-label="More"]') ||
    article.querySelector('button[aria-label="More menu items"]');

  if (!menuButton) return null;

  const anchor =
    menuButton.closest("button, a, div[role='button']") || menuButton;
  const host = anchor.parentElement;
  if (!host) return null;

  return { host, anchor };
}

function positionReplyButton(button, article, anchor) {
  if (
    !(button instanceof HTMLElement) ||
    !(article instanceof HTMLElement) ||
    !(anchor instanceof HTMLElement)
  ) {
    return;
  }

  if (window.getComputedStyle(article).position === "static") {
    article.style.position = "relative";
  }

  const articleRect = article.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const buttonSize = 32;
  const gap = 8;

  const top = Math.max(
    8,
    anchorRect.top - articleRect.top + (anchorRect.height - buttonSize) / 2,
  );
  const left = Math.max(
    8,
    anchorRect.left - articleRect.left - buttonSize - gap,
  );

  button.style.position = "absolute";
  button.style.top = `${Math.round(top)}px`;
  button.style.left = `${Math.round(left)}px`;
  button.style.zIndex = "2147483645";
}

function installReplyButton(article) {
  const placement = findReplyButtonPlacement(article);
  if (!placement) return;

  let button = article.querySelector(`[${REPLY_BUTTON_ATTR}]`);
  if (!(button instanceof HTMLButtonElement)) {
    button = document.createElement("button");
    button.type = "button";
    button.setAttribute(REPLY_BUTTON_ATTR, "1");
    button.title = "Write a reply with X Master";
    button.setAttribute("aria-label", "Write a reply with X Master");

    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "32px",
      height: "32px",
      padding: "0",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.05)",
      cursor: "pointer",
      color: "#71767b",
      transition: "background 120ms ease, border-color 120ms ease",
    });

    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(29,155,240,0.12)";
      button.style.borderColor = "rgba(29,155,240,0.3)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "rgba(255,255,255,0.05)";
      button.style.borderColor = "rgba(255,255,255,0.08)";
    });

    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("icons/icon32.png");
    icon.alt = "";
    Object.assign(icon.style, {
      width: "16px",
      height: "16px",
      display: "block",
      borderRadius: "4px",
    });

    button.appendChild(icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openReplyPanel(article, button);
    });

    article.appendChild(button);
  }

  positionReplyButton(button, article, placement.anchor);
}

function refreshButtons(root) {
  const articles = new Set();

  if (root?.matches?.(ARTICLE_SELECTOR)) {
    articles.add(root);
  }

  const closestArticle = root?.closest?.(ARTICLE_SELECTOR);
  if (closestArticle) {
    articles.add(closestArticle);
  }

  root?.querySelectorAll?.(ARTICLE_SELECTOR)?.forEach((article) => {
    articles.add(article);
  });

  articles.forEach((article) => {
    installReplyButton(article);
    installDriveButton(article);
  });
}

function extractFromArticleContext(target) {
  const skippedTags = new Set(["NAV", "HEADER", "FOOTER", "ASIDE", "SCRIPT", "STYLE"]);

  let current = target;
  let bestMatch = null;
  let bestLength = 0;

  while (current && current !== document.body) {
    if (!skippedTags.has(current.tagName)) {
      const length = (current.innerText ?? "").trim().length;
      if (length > bestLength && length > 400) {
        bestMatch = current;
        bestLength = length;
      }
    }

    current = current.parentElement;
  }

  if (!bestMatch) return null;

  const parts = Array.from(bestMatch.querySelectorAll("h1,h2,h3,h4,p,li,blockquote"))
    .map((node) => node.innerText.trim())
    .filter(Boolean);
  const deduped = parts.filter(
    (line, index) => index === 0 || line !== parts[index - 1],
  );
  const text = cleanText(deduped.length ? deduped.join("\n\n") : bestMatch.innerText);

  if (!text) return null;

  const identity = getAuthorFromPage();

  return {
    text,
    tweetUrl: window.location.href,
    authorName: identity.authorName,
    authorHandle: identity.authorHandle || handleFromStatusUrl(window.location.href),
  };
}

function optionsMarkup(options, selectedId) {
  return options
    .map(
      (option) =>
        `<option value="${option.id}"${
          option.id === selectedId ? " selected" : ""
        }>${option.label}</option>`,
    )
    .join("");
}

function getStoredReplySettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([REPLY_TONE_KEY, REPLY_LENGTH_KEY], (values) => {
      const toneIds = new Set(TONE_OPTIONS.map((option) => option.id));
      const lengthIds = new Set(LENGTH_OPTIONS.map((option) => option.id));

      const toneId = toneIds.has(values?.[REPLY_TONE_KEY])
        ? values[REPLY_TONE_KEY]
        : "persuasive";
      const lengthId = lengthIds.has(values?.[REPLY_LENGTH_KEY])
        ? values[REPLY_LENGTH_KEY]
        : "regular_post";

      resolve({ toneId, lengthId });
    });
  });
}

function saveReplySettings(nextSettings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(nextSettings, resolve);
  });
}

function closeReplyPanel() {
  if (!activeReplyPanel) return;
  activeReplyPanel.panel.remove();
  activeReplyPanel = null;
}

function positionReplyPanel(panel, button) {
  const width = Math.min(340, window.innerWidth - 24);
  const margin = 12;
  const rect = button.getBoundingClientRect();
  const panelHeight = panel.offsetHeight || 250;

  const left = Math.max(
    margin,
    Math.min(rect.right - width, window.innerWidth - width - margin),
  );
  const top = Math.max(
    margin,
    Math.min(rect.bottom + 10, window.innerHeight - panelHeight - margin),
  );

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function requestGeneratedReply(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: REPLY_GENERATION_MESSAGE, payload }, (response) => {
      const errorMessage = chrome.runtime.lastError?.message || response?.error;
      if (errorMessage || !response?.ok) {
        reject(new Error(errorMessage || "Could not generate a reply."));
        return;
      }

      resolve(response);
    });
  });
}

async function openReplyPanel(article, button) {
  if (activeReplyPanel?.button === button) {
    closeReplyPanel();
    return;
  }

  closeReplyPanel();
  const settings = await getStoredReplySettings();
  const targetTweet = extractFromTweetArticle(article);
  const targetHandle = targetTweet.authorHandle ? `@${targetTweet.authorHandle}` : "";
  const targetAuthor = targetTweet.authorName || targetHandle || "this tweet";
  const targetPreview = cleanText(targetTweet.text).slice(0, 180);

  const panel = document.createElement("div");
  panel.id = REPLY_PANEL_ID;
  Object.assign(panel.style, {
    position: "fixed",
    zIndex: "2147483647",
    width: "min(340px, calc(100vw - 24px))",
    padding: "14px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(10,10,11,0.98)",
    color: "#f4f4f5",
    boxShadow: "0 18px 52px rgba(0,0,0,0.52)",
    backdropFilter: "blur(14px)",
    fontFamily: "TwitterChirp, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  });

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
      <div>
        <div style="font-size:13px;font-weight:750;letter-spacing:0.01em">X Master Reply</div>
        <div style="font-size:11px;color:#a1a1aa;margin-top:4px">Target is locked before generation.</div>
      </div>
      <button data-xm-close type="button" aria-label="Close" style="width:28px;height:28px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;background:rgba(255,255,255,0.05);color:#e4e4e7;cursor:pointer;font-size:18px;line-height:1">x</button>
    </div>
    <div style="border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.035);padding:10px;margin-bottom:12px">
      <div style="display:flex;align-items:baseline;gap:6px;min-width:0">
        <div style="font-size:12px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(targetAuthor)}</div>
        ${targetHandle ? `<div style="font-size:11px;color:#71717a;white-space:nowrap">${escapeHtml(targetHandle)}</div>` : ""}
      </div>
      <div style="margin-top:6px;font-size:12px;line-height:1.45;color:#d4d4d8;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">
        ${escapeHtml(targetPreview || "No tweet text found yet.")}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label style="display:block">
        <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#71717a;margin-bottom:6px">Length</span>
        <select data-xm-length style="width:100%;height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#17171a;color:#f4f4f5;padding:0 10px;outline:none">
          ${optionsMarkup(LENGTH_OPTIONS, settings.lengthId)}
        </select>
      </label>
      <label style="display:block">
        <span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#71717a;margin-bottom:6px">Feeling</span>
        <select data-xm-tone style="width:100%;height:38px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#17171a;color:#f4f4f5;padding:0 10px;outline:none">
          ${optionsMarkup(TONE_OPTIONS, settings.toneId)}
        </select>
      </label>
    </div>
    <div data-xm-status style="min-height:30px;margin-top:12px;font-size:12px;line-height:1.45;color:#a1a1aa">
      The reply will be inserted into the tweet shown above.
    </div>
    <button data-xm-generate type="button" style="width:100%;margin-top:12px;height:42px;border:none;border-radius:8px;background:#ffffff;color:#09090b;font-size:13px;font-weight:750;cursor:pointer">
      Write reply
    </button>
  `;

  document.body.appendChild(panel);
  positionReplyPanel(panel, button);

  activeReplyPanel = { panel, button, article };

  const closeButton = panel.querySelector("[data-xm-close]");
  const generateButton = panel.querySelector("[data-xm-generate]");
  const toneSelect = panel.querySelector("[data-xm-tone]");
  const lengthSelect = panel.querySelector("[data-xm-length]");
  const status = panel.querySelector("[data-xm-status]");

  closeButton?.addEventListener("click", () => closeReplyPanel());

  toneSelect?.addEventListener("change", () => {
    void saveReplySettings({ [REPLY_TONE_KEY]: toneSelect.value });
  });

  lengthSelect?.addEventListener("change", () => {
    void saveReplySettings({ [REPLY_LENGTH_KEY]: lengthSelect.value });
  });

  generateButton?.addEventListener("click", async () => {
    const freshTweetData = extractFromTweetArticle(article);
    const tweetData = freshTweetData.text ? freshTweetData : targetTweet;
    if (!tweetData.text) {
      status.textContent = "Could not find enough tweet text to reply to.";
      status.style.color = "#fca5a5";
      return;
    }

    const payload = {
      tweetText: tweetData.text,
      tweetUrl: tweetData.tweetUrl,
      authorName: tweetData.authorName,
      authorHandle: tweetData.authorHandle,
      toneId: toneSelect.value,
      lengthId: lengthSelect.value,
    };

    generateButton.disabled = true;
    generateButton.style.opacity = "0.6";
    status.textContent = "Writing from your saved database...";
    status.style.color = "#a1a1aa";

    try {
      await saveReplySettings({
        [REPLY_TONE_KEY]: toneSelect.value,
        [REPLY_LENGTH_KEY]: lengthSelect.value,
      });

      const reply = await requestGeneratedReply(payload);
      status.textContent = "Opening the reply box...";

      const insertResult = await insertReplyIntoTweet(article, reply.content);
      if (!insertResult?.ok) {
        throw new Error(insertResult?.error || "Could not insert the reply.");
      }

      closeReplyPanel();

      const referenceLine = reply.referencesUsed
        ? ` ${reply.referencesUsed} style example${
            reply.referencesUsed === 1 ? "" : "s"
          } used.`
        : "";
      showToast(`Reply ready. Press Reply.${referenceLine}`);
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Could not generate a reply.";
      status.style.color = "#fca5a5";
    } finally {
      generateButton.disabled = false;
      generateButton.style.opacity = "1";
    }
  });
}

function findComposeCloseButton(editor) {
  let current = editor.parentElement;

  while (current && current !== document.body) {
    const candidate = current.querySelector('[aria-label="Back"]');
    if (candidate instanceof HTMLElement) {
      return candidate;
    }
    current = current.parentElement;
  }

  const pageLevelBackButton = document.querySelector('[aria-label="Back"]');
  return pageLevelBackButton instanceof HTMLElement ? pageLevelBackButton : null;
}

function findSaveDraftButton() {
  const byTestId = document.querySelector(
    '[data-testid="confirmationSheetConfirm"]',
  );
  if (byTestId instanceof HTMLElement && isVisibleElement(byTestId)) {
    return byTestId;
  }

  return (
    Array.from(document.querySelectorAll('[role="button"], button')).find(
      (button) =>
        button instanceof HTMLElement &&
        isVisibleElement(button) &&
        /^save( draft)?$/i.test((button.textContent ?? "").trim()),
    ) ?? null
  );
}

async function saveToXDraft(text) {
  const composeButton = document.querySelector(
    '[data-testid="SideNav_NewTweet_Button"]',
  );
  if (!(composeButton instanceof HTMLElement)) {
    return {
      ok: false,
      error: "Could not find the compose button. Make sure you are on X.com.",
    };
  }

  const previousEditors = new Set(getVisibleComposeEditors());
  composeButton.click();

  const editor = await waitForComposeEditor(previousEditors, 4000);
  if (!(editor instanceof HTMLElement)) {
    return { ok: false, error: "Could not open the X compose window." };
  }

  await sleep(180);
  const inserted = await replaceComposeText(editor, text);
  if (!inserted.ok) {
    return inserted;
  }

  const closeButton = findComposeCloseButton(editor);
  if (closeButton) {
    closeButton.click();
  } else {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  const saveButton = await waitForElement(findSaveDraftButton, 3000);
  if (!(saveButton instanceof HTMLElement)) {
    return {
      ok: false,
      error: "X save-draft dialog did not appear.",
    };
  }

  saveButton.click();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SAVE_TO_X_DRAFT") {
    saveToXDraft(message.text ?? "").then(sendResponse);
    return true;
  }

  if (
    message.type === "OPEN_TWITTER_COMPOSE" ||
    message.type === "SET_X_COMPOSE_TEXT"
  ) {
    openGlobalCompose(message.text ?? "").then(sendResponse);
    return true;
  }

  if (message.type !== "GET_TWEET_DATA") return undefined;

  const tweetArticle = lastTarget && closestTweetArticle(lastTarget);
  if (tweetArticle) {
    sendResponse({ data: extractFromTweetArticle(tweetArticle) });
    return undefined;
  }

  const anyTweet = document.querySelector(ARTICLE_SELECTOR);
  if (anyTweet) {
    sendResponse({ data: extractFromTweetArticle(anyTweet) });
    return undefined;
  }

  sendResponse({ error: "Could not find any content to save on this page." });
  return undefined;
});

function scheduleButtonRefresh(root = document) {
  if (pendingRefresh) return;
  pendingRefresh = true;

  window.requestAnimationFrame(() => {
    pendingRefresh = false;
    refreshButtons(root);
  });
}

scheduleButtonRefresh(document);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type !== "childList") continue;

    mutation.addedNodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        scheduleButtonRefresh(node);
      }
    });
  }
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
}
