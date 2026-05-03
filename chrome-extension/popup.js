const input = document.getElementById("appUrl");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

chrome.storage.sync.get("appUrl", ({ appUrl }) => {
  input.value = appUrl || "http://localhost:3000";
});

saveBtn.addEventListener("click", () => {
  const url = input.value.trim().replace(/\/$/, "");
  if (!url) {
    status.textContent = "Enter a valid URL.";
    return;
  }

  chrome.storage.sync.set({ appUrl: url }, () => {
    status.textContent = "Saved.";
    setTimeout(() => { status.textContent = ""; }, 1500);
  });
});
