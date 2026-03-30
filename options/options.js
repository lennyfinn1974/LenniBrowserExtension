/**
 * Lenni Extension Options — settings page.
 */

const urlInput = document.getElementById("lenni-url");
const tokenInput = document.getElementById("auth-token");
const autoOpen = document.getElementById("auto-open");
const showNotifs = document.getElementById("show-notifications");
const testBtn = document.getElementById("btn-test");
const testResult = document.getElementById("test-result");
const saveBtn = document.getElementById("btn-save");
const saveStatus = document.getElementById("save-status");

// Load saved settings
chrome.storage.sync.get(
  {
    lenniUrl: "http://localhost:8200",
    authToken: "",
    autoOpenSidebar: false,
    showNotifications: true,
    ctxAsk: true,
    ctxExplain: true,
    ctxRemember: true,
    ctxSummarise: true,
  },
  (items) => {
    urlInput.value = items.lenniUrl;
    tokenInput.value = items.authToken;
    autoOpen.checked = items.autoOpenSidebar;
    showNotifs.checked = items.showNotifications;
    document.getElementById("ctx-ask").checked = items.ctxAsk;
    document.getElementById("ctx-explain").checked = items.ctxExplain;
    document.getElementById("ctx-remember").checked = items.ctxRemember;
    document.getElementById("ctx-summarise").checked = items.ctxSummarise;
  }
);

// Test connection
testBtn.addEventListener("click", async () => {
  testResult.textContent = "Testing...";
  testResult.style.color = "#6b7280";

  const url = urlInput.value.replace(/\/$/, "");
  try {
    const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      testResult.textContent = `Connected! ${data.status} — ${data.skill_count || 0} skills`;
      testResult.style.color = "#34d399";
    } else {
      testResult.textContent = `Error: HTTP ${resp.status}`;
      testResult.style.color = "#f87171";
    }
  } catch (e) {
    testResult.textContent = "Cannot connect. Is Lenni running?";
    testResult.style.color = "#f87171";
  }
});

// Save
saveBtn.addEventListener("click", () => {
  chrome.storage.sync.set(
    {
      lenniUrl: urlInput.value.replace(/\/$/, "") || "http://localhost:8200",
      authToken: tokenInput.value,
      autoOpenSidebar: autoOpen.checked,
      showNotifications: showNotifs.checked,
      ctxAsk: document.getElementById("ctx-ask").checked,
      ctxExplain: document.getElementById("ctx-explain").checked,
      ctxRemember: document.getElementById("ctx-remember").checked,
      ctxSummarise: document.getElementById("ctx-summarise").checked,
    },
    () => {
      saveStatus.textContent = "Saved!";
      saveStatus.style.color = "#34d399";
      setTimeout(() => {
        saveStatus.textContent = "";
      }, 2000);

      // Notify background to reconnect
      chrome.runtime.sendMessage({ target: "background", type: "config_updated" });
    }
  );
});
