/**
 * Lenni Popup — Quick actions + connection status + CDP bridge.
 */

const dotLenni = document.getElementById("dot-lenni");
const dotCdp = document.getElementById("dot-cdp");
const statusLenni = document.getElementById("status-lenni");
const statusCdp = document.getElementById("status-cdp");
const cdpSection = document.getElementById("cdp-section");

// Check status
chrome.runtime.sendMessage({ target: "background", type: "get_status" }, (r) => {
  if (r) {
    dotLenni.className = `dot ${r.connected ? "on" : "off"}`;
    statusLenni.textContent = r.connected ? "Connected" : "Offline";

    dotCdp.className = `dot ${r.cdpConnected ? "on" : "off"}`;
    statusCdp.textContent = r.cdpConnected ? "Active" : "Off";

    // Show enable button if Lenni connected but CDP not
    cdpSection.classList.toggle("hidden", r.cdpConnected || !r.connected);
  }
});

// Quick actions
document.getElementById("btn-summarise").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    if (chrome.sidePanel) await chrome.sidePanel.open({ tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }, (response) => {
      if (response?.content) {
        chrome.runtime.sendMessage({
          target: "background", type: "send_message",
          text: `Summarise this page: ${tab.title}\n\n${response.content.slice(0, 3000)}`,
          url: tab.url, title: tab.title,
        });
        chrome.runtime.sendMessage({ target: "sidebar", type: "user_message", text: `Summarise: ${tab.title}` });
      }
    });
  }
  window.close();
});

document.getElementById("btn-facts").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    if (chrome.sidePanel) await chrome.sidePanel.open({ tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }, (response) => {
      if (response?.content) {
        chrome.runtime.sendMessage({
          target: "background", type: "send_message",
          text: `Find key facts and important numbers: ${tab.title}\n\n${response.content.slice(0, 3000)}`,
          url: tab.url, title: tab.title,
        });
        chrome.runtime.sendMessage({ target: "sidebar", type: "user_message", text: `Key facts: ${tab.title}` });
      }
    });
  }
  window.close();
});

document.getElementById("btn-screenshot").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
      chrome.runtime.sendMessage({
        target: "background", type: "send_message",
        text: `Screenshot of: ${tab.title}`, screenshot: dataUrl,
        url: tab.url, title: tab.title,
      });
      chrome.tabs.sendMessage(tab.id, { action: "showToast", text: "Screenshot sent to Lenni" });
    } catch (e) {}
  }
  window.close();
});

document.getElementById("btn-chat").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && chrome.sidePanel) await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});

// Enable browser control
document.getElementById("btn-enable-cdp").addEventListener("click", () => {
  chrome.runtime.sendMessage({ target: "background", type: "enable_browser_control" });
  statusCdp.textContent = "Connecting...";
  setTimeout(() => {
    chrome.runtime.sendMessage({ target: "background", type: "check_cdp" });
    window.close();
  }, 3000);
});

document.getElementById("btn-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});
