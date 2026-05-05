const input = document.getElementById("appUrl");
const saveBtn = document.getElementById("save");
const detectBtn = document.getElementById("detect");
const status = document.getElementById("status");

chrome.storage.sync.get("appUrl", ({ appUrl }) => {
  input.value = appUrl || "http://localhost:3000";
});

saveBtn.addEventListener("click", () => {
  const url = input.value.trim().replace(/\/$/, "");
  if (!url) { status.textContent = "Enter a valid URL."; return; }
  chrome.storage.sync.set({ appUrl: url }, () => {
    status.textContent = "Saved.";
    setTimeout(() => { status.textContent = ""; }, 1500);
  });
});

detectBtn.addEventListener("click", async () => {
  status.textContent = "Scanning ports…";
  detectBtn.disabled = true;

  const ports = [3000, 3001, 3002, 3003];
  let found = null;

  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}/api/drafts`, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 405) { found = `http://localhost:${port}`; break; }
    } catch { /* keep trying */ }
  }

  detectBtn.disabled = false;
  if (found) {
    input.value = found;
    chrome.storage.sync.set({ appUrl: found });
    status.textContent = `Found at ${found} — saved!`;
  } else {
    status.textContent = "Not found. Is the app running?";
  }
  setTimeout(() => { status.textContent = ""; }, 3000);
});
