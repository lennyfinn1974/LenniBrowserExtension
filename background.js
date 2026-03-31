/**
 * Lenni Browser Extension — Background Service Worker
 *
 * Three roles:
 *   1. WebSocket to Lenni backend (chat, remember, status)
 *   2. Context menu actions (ask, explain, remember, summarise, screenshot)
 *   3. Chrome DevTools Protocol bridge (facilitate chrome-devtools-mcp)
 */

const DEFAULT_LENNI_URL = "http://localhost:8200";
let ws = null;
let wsReconnectTimer = null;
let lenniUrl = DEFAULT_LENNI_URL;
let authToken = "";
let conversationId = null;
let cdpConnected = false;

// Sites the user has pre-approved for all actions
const allowedSites = new Set();

// ── Config ───────────────────────────────────────────────────────

async function loadConfig() {
  const cfg = await chrome.storage.sync.get({
    lenniUrl: DEFAULT_LENNI_URL,
    authToken: "",
    showContextMenu: true,
    autoOpenSidebar: false,
  });
  lenniUrl = cfg.lenniUrl;
  authToken = cfg.authToken;
  return cfg;
}

// ── WebSocket ────────────────────────────────────────────────────

function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const wsUrl = lenniUrl.replace("http", "ws") + "/ws/extension";
  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    clearReconnectTimer();
    if (authToken) ws.send(JSON.stringify({ type: "auth", token: authToken }));
    broadcastStatus();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Handle browser control messages from Lenni
      if (data.type === "browser_action_request") {
        handleBrowserActionRequest(data);
        return;
      }

      // Forward to sidebar
      chrome.runtime.sendMessage({ target: "sidebar", ...data }).catch(() => {});
    } catch (e) {}
  };

  ws.onclose = () => {
    ws = null;
    broadcastStatus();
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws = null;
    broadcastStatus();
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearReconnectTimer();
  wsReconnectTimer = setTimeout(connectWebSocket, 5000);
}

function clearReconnectTimer() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
}

function broadcastStatus() {
  chrome.runtime.sendMessage({
    target: "sidebar",
    type: "connection_status",
    connected: ws && ws.readyState === WebSocket.OPEN,
    cdpConnected,
  }).catch(() => {});
}

function sendToLenni(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    sendViaHTTP(message);
  }
}

async function sendViaHTTP(message) {
  try {
    const response = await fetch(`${lenniUrl}/chat/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        content: message.text || message.content || "",
        conversation_id: conversationId,
        channel: "extension",
        metadata: { url: message.url, page_title: message.title },
      }),
    });

    if (response.ok) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              if (payload.startsWith("data: ")) {
                const parsed = JSON.parse(payload.slice(6));
                chrome.runtime.sendMessage({ target: "sidebar", ...parsed }).catch(() => {});
              } else {
                const parsed = JSON.parse(payload);
                chrome.runtime.sendMessage({ target: "sidebar", ...parsed }).catch(() => {});
              }
            } catch (e) {
              chrome.runtime.sendMessage({ target: "sidebar", type: "token", data: payload }).catch(() => {});
            }
          }
        }
      }
    }
  } catch (e) {
    chrome.runtime.sendMessage({
      target: "sidebar", type: "error",
      data: "Cannot connect to Lenni. Is the backend running?",
    }).catch(() => {});
  }
}

// ── Browser Control Bridge (CDP) ─────────────────────────────────

async function handleBrowserActionRequest(data) {
  const { action_id, action, description, selector, url, tier } = data;

  // Auto-approved actions (read-only)
  if (tier === "auto_approved") {
    respondToAction(action_id, true);
    return;
  }

  // Check if site is pre-approved
  try {
    const siteHost = new URL(url || "").hostname;
    if (allowedSites.has(siteHost)) {
      respondToAction(action_id, true);
      return;
    }
  } catch (e) {}

  // Show highlight + confirmation overlay on the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    respondToAction(action_id, false);
    return;
  }

  // Highlight the target element
  if (selector) {
    chrome.tabs.sendMessage(tab.id, {
      action: "highlightElement", selector, tier,
    }).catch(() => {});
  }

  // Show confirmation overlay
  chrome.tabs.sendMessage(tab.id, {
    action: "showConfirmation",
    actionId: action_id,
    description: description || `${action} on page`,
    target: selector,
    url,
    tier,
  }).catch(() => {});
}

function respondToAction(actionId, approved) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "action_confirmation",
      action_id: actionId,
      approved,
    }));
  }
}

async function checkCDPStatus() {
  try {
    const resp = await fetch(`${lenniUrl}/settings/system`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (resp.ok) {
      const data = await resp.json();
      cdpConnected = data?.services?.browser_live?.status === "connected";
      broadcastStatus();
    }
  } catch (e) {
    cdpConnected = false;
  }
}

async function enableBrowserControl() {
  // Signal Lenni to connect chrome-devtools-mcp
  sendToLenni({ type: "browser_control_status", connected: true });
  // Check status after a delay
  setTimeout(checkCDPStatus, 5000);
}

// ── Context Menus ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await loadConfig();

  chrome.contextMenus.create({ id: "ask-lenni", title: "Ask Lenni about this", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "explain-lenni", title: "Explain this", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "remember-lenni", title: "Remember this", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "separator-1", type: "separator", contexts: ["page", "selection"] });
  chrome.contextMenus.create({ id: "summarise-page", title: "Summarise this page", contexts: ["page"] });
  chrome.contextMenus.create({ id: "screenshot-page", title: "Screenshot for Lenni", contexts: ["page"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (chrome.sidePanel) await chrome.sidePanel.open({ tabId: tab.id });

  const baseMsg = { url: tab.url, title: tab.title };

  switch (info.menuItemId) {
    case "ask-lenni":
      sendToLenni({ type: "chat", text: `Analyse this: "${info.selectionText}"`, ...baseMsg });
      chrome.runtime.sendMessage({
        target: "sidebar", type: "user_message",
        text: `Analyse: "${info.selectionText?.slice(0, 200)}"`,
      }).catch(() => {});
      break;

    case "explain-lenni":
      sendToLenni({ type: "chat", text: `Explain this in simple terms: "${info.selectionText}"`, ...baseMsg });
      chrome.runtime.sendMessage({
        target: "sidebar", type: "user_message",
        text: `Explain: "${info.selectionText?.slice(0, 200)}"`,
      }).catch(() => {});
      break;

    case "remember-lenni":
      sendToLenni({ type: "remember", text: info.selectionText, ...baseMsg });
      chrome.tabs.sendMessage(tab.id, { action: "showToast", text: "Saved to Lenni memory" }).catch(() => {});
      break;

    case "summarise-page":
      chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }, (response) => {
        if (response?.content) {
          sendToLenni({
            type: "chat",
            text: "Summarise this page",
            page_content: response.content.slice(0, 5000),
            ...baseMsg,
          });
          chrome.runtime.sendMessage({
            target: "sidebar", type: "user_message",
            text: `Summarise: ${tab.title}`,
          }).catch(() => {});
        }
      });
      break;

    case "screenshot-page":
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
        sendToLenni({
          type: "chat",
          text: `I'm sharing a screenshot of my current page: ${tab.title}`,
          screenshot: dataUrl,
          ...baseMsg,
        });
        chrome.tabs.sendMessage(tab.id, { action: "showToast", text: "Screenshot sent to Lenni" }).catch(() => {});
      } catch (e) {
        chrome.tabs.sendMessage(tab.id, { action: "showToast", text: "Screenshot failed" }).catch(() => {});
      }
      break;
  }
});

// ── Message handling from sidebar/popup/content ──────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "background") {
    switch (message.type) {
      case "send_message":
        sendToLenni({ type: "chat", text: message.text, url: message.url, title: message.title });
        break;

      case "get_status":
        sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN, url: lenniUrl, cdpConnected });
        return true;

      case "reconnect":
        connectWebSocket();
        break;

      case "config_updated":
        loadConfig().then(() => { if (ws) ws.close(); connectWebSocket(); });
        break;

      case "enable_browser_control":
        enableBrowserControl();
        break;

      case "check_cdp":
        checkCDPStatus();
        break;

      case "action_confirmation":
        // From content script confirmation overlay
        respondToAction(message.action_id, message.approved);
        // If "allow all for this site"
        if (message.allow_site && message.url) {
          try { allowedSites.add(new URL(message.url).hostname); } catch (e) {}
        }
        break;
    }
  }
});

// ── Startup ──────────────────────────────────────────────────────

loadConfig().then(() => {
  connectWebSocket();
  checkCDPStatus();
});
