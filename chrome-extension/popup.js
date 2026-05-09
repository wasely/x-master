const draftInput = document.getElementById("draftInput");
const enhancedOutput = document.getElementById("enhancedOutput");
const input = document.getElementById("appUrl");
const vercelBypassInput = document.getElementById("vercelBypassToken");
const enhanceBtn = document.getElementById("enhance");
const copyBtn = document.getElementById("copy");
const useOnXBtn = document.getElementById("useOnX");
const clearBtn = document.getElementById("clear");
const saveBtn = document.getElementById("save");
const detectBtn = document.getElementById("detect");
const status = document.getElementById("status");
const targetTab = document.getElementById("targetTab");
const DEFAULT_APP_URL = "https://x-master-iy458bg51-wasely-3997s-projects.vercel.app";
const PORTS = [3000, 3001, 3002, 3003];

function setStatus(message, state = "") {
  status.textContent = message;
  status.dataset.state = state;
}

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function normalizeBypassToken(token) {
  return String(token || "").trim();
}

function withBypassHeaders(headers = {}, token = vercelBypassInput?.value) {
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
    appUrl: normalizeUrl(input?.value || appUrl || DEFAULT_APP_URL),
    vercelBypassToken: normalizeBypassToken(vercelBypassInput?.value || vercelBypassToken),
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

async function findAppUrl() {
  const { appUrl, vercelBypassToken } = await getConnectionSettings();
  const candidates = [
    appUrl,
    DEFAULT_APP_URL,
    ...PORTS.map((port) => `http://localhost:${port}`),
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    if (await probeAppUrl(url, vercelBypassToken)) {
      await chrome.storage.sync.set({ appUrl: url });
      input.value = url;
      return url;
    }
  }

  return null;
}

function setBusy(isBusy) {
  enhanceBtn.disabled = isBusy;
  detectBtn.disabled = isBusy;
  saveBtn.disabled = isBusy;
}

function formatTabTarget(tab) {
  const url = tab?.url || "";
  const title = tab?.title || "";
  const isX = /^https:\/\/(?:x|twitter)\.com\//i.test(url);

  if (!tab?.id) {
    return { text: "No active tab found.", state: "warn" };
  }

  if (!isX) {
    return { text: "Active tab is not X. Switch to the X tab before inserting.", state: "warn" };
  }

  return {
    text: `Active X tab: ${title || url}`,
    state: "",
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function updateTargetTab() {
  const tab = await getActiveTab().catch(() => null);
  const target = formatTabTarget(tab);
  targetTab.textContent = target.text;
  targetTab.dataset.state = target.state;
}

function persistDraftState() {
  chrome.storage.local.set({
    extensionReplyDraft: draftInput.value,
    extensionReplyEnhanced: enhancedOutput.value,
  });
}

void Promise.all([
  chrome.storage.sync.get("appUrl"),
  chrome.storage.local.get("vercelBypassToken"),
]).then(([{ appUrl }, { vercelBypassToken }]) => {
  input.value = normalizeUrl(appUrl || DEFAULT_APP_URL);
  vercelBypassInput.value = vercelBypassToken || "";
});

chrome.storage.local.get(
  ["extensionReplyDraft", "extensionReplyEnhanced"],
  ({ extensionReplyDraft, extensionReplyEnhanced }) => {
    if (typeof extensionReplyDraft === "string") {
      draftInput.value = extensionReplyDraft;
    }

    if (typeof extensionReplyEnhanced === "string") {
      enhancedOutput.value = extensionReplyEnhanced;
    }
  },
);

void updateTargetTab();

draftInput.addEventListener("input", persistDraftState);
enhancedOutput.addEventListener("input", persistDraftState);

saveBtn.addEventListener("click", () => {
  const url = normalizeUrl(input.value || DEFAULT_APP_URL);
  if (!url) {
    setStatus("Enter a valid URL.", "error");
    return;
  }

  Promise.all([
    chrome.storage.sync.set({ appUrl: url }),
    chrome.storage.local.set({ vercelBypassToken: normalizeBypassToken(vercelBypassInput.value) }),
  ]).then(() => {
    setStatus("Saved.", "success");
    setTimeout(() => { setStatus(""); }, 1500);
  });
});

detectBtn.addEventListener("click", async () => {
  setStatus("Checking hosted app and localhost ports...");
  detectBtn.disabled = true;

  const found = await findAppUrl();

  detectBtn.disabled = false;
  if (found) {
    setStatus(`Found at ${found}.`, "success");
  } else {
    setStatus("Not found. Check the URL or Vercel bypass token.", "error");
  }
  setTimeout(() => { setStatus(""); }, 3000);
});

enhanceBtn.addEventListener("click", async () => {
  const text = draftInput.value.trim();
  if (!text) {
    setStatus("Paste a reply draft first.", "error");
    draftInput.focus();
    return;
  }

  setBusy(true);
  setStatus("Enhancing reply...");

  try {
    const appUrl = await findAppUrl();
    if (!appUrl) {
      throw new Error("Could not reach X Master. Check the hosted URL or Vercel bypass token.");
    }

    const response = await fetch(`${appUrl}/api/extension/enhance-reply`, {
      method: "POST",
      headers: withBypassHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || `Server returned ${response.status}.`);
    }

    enhancedOutput.value = typeof data?.content === "string" ? data.content : "";
    persistDraftState();
    setStatus("Reply enhanced.", "success");
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Could not enhance reply.",
      "error",
    );
  } finally {
    setBusy(false);
  }
});

copyBtn.addEventListener("click", async () => {
  const text = (enhancedOutput.value || draftInput.value).trim();
  if (!text) {
    setStatus("Nothing to copy yet.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied.", "success");
  } catch {
    setStatus("Could not copy to clipboard.", "error");
  }
});

useOnXBtn.addEventListener("click", async () => {
  const text = (enhancedOutput.value || draftInput.value).trim();
  if (!text) {
    setStatus("Nothing to insert yet.", "error");
    return;
  }

  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      throw new Error("Could not find the active tab.");
    }
    if (!/^https:\/\/(?:x|twitter)\.com\//i.test(tab.url || "")) {
      throw new Error("Switch to the X tab you want to insert into, then open this popup again.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "SET_X_COMPOSE_TEXT",
      text,
    });

    if (response?.error) {
      throw new Error(response.error);
    }

    setStatus(`Inserted into ${tab.title || "the active X tab"}.`, "success");
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : "Could not insert the reply into X.",
      "error",
    );
  }
});

clearBtn.addEventListener("click", () => {
  draftInput.value = "";
  enhancedOutput.value = "";
  persistDraftState();
  setStatus("");
  draftInput.focus();
});
