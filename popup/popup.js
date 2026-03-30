/**
 * Lenni Popup — Quick actions from the toolbar icon.
 */

const statusEl = document.getElementById("status");

// Check connection
chrome.runtime.sendMessage(
  { target: "background", type: "get_status" },
  (response) => {
    if (response && response.connected) {
      statusEl.textContent = "Online";
      statusEl.className = "status connected";
    } else {
      statusEl.textContent = "Offline";
      statusEl.className = "status disconnected";
    }
  }
);

// Summarise page
document.getElementById("btn-summarise").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    // Open sidebar
    if (chrome.sidePanel) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    // Send summarise via context menu handler
    chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }, (response) => {
      if (response && response.content) {
        chrome.runtime.sendMessage({
          target: "background",
          type: "send_message",
          text: `Summarise this page: ${tab.title}\n\n${response.content.slice(0, 3000)}`,
          url: tab.url,
          title: tab.title,
        });
        chrome.runtime.sendMessage({
          target: "sidebar",
          type: "user_message",
          text: `Summarise: ${tab.title}`,
        });
      }
    });
  }
  window.close();
});

// Find key facts
document.getElementById("btn-facts").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    if (chrome.sidePanel) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }, (response) => {
      if (response && response.content) {
        chrome.runtime.sendMessage({
          target: "background",
          type: "send_message",
          text: `Find the key facts and important numbers on this page: ${tab.title}\n\n${response.content.slice(0, 3000)}`,
          url: tab.url,
          title: tab.title,
        });
        chrome.runtime.sendMessage({
          target: "sidebar",
          type: "user_message",
          text: `Key facts: ${tab.title}`,
        });
      }
    });
  }
  window.close();
});

// Open sidebar for chat
document.getElementById("btn-chat").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && chrome.sidePanel) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
  window.close();
});

// Options
document.getElementById("btn-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});
