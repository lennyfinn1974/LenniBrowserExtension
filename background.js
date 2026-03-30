/**
 * Lenni Browser Extension — Background Service Worker
 *
 * Manages WebSocket connection to Lenni backend, context menus,
 * and message routing between content scripts and sidebar.
 */

const DEFAULT_LENNI_URL = "http://localhost:8200";
let ws = null;
let wsReconnectTimer = null;
let lenniUrl = DEFAULT_LENNI_URL;
let authToken = "";
let conversationId = null;

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
    console.warn("Lenni WS connect failed:", e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log("Lenni WS connected");
    clearReconnectTimer();
    // Authenticate
    if (authToken) {
      ws.send(JSON.stringify({ type: "auth", token: authToken }));
    }
    broadcastStatus(true);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      // Forward to sidebar
      chrome.runtime.sendMessage({ target: "sidebar", ...data }).catch(() => {});
    } catch (e) {
      console.warn("Lenni WS parse error:", e);
    }
  };

  ws.onclose = () => {
    console.log("Lenni WS closed");
    ws = null;
    broadcastStatus(false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws = null;
    broadcastStatus(false);
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearReconnectTimer();
  wsReconnectTimer = setTimeout(connectWebSocket, 5000);
}

function clearReconnectTimer() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
}

function broadcastStatus(connected) {
  chrome.runtime.sendMessage({
    target: "sidebar",
    type: "connection_status",
    connected,
  }).catch(() => {});
}

function sendToLenni(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    // Fallback to HTTP
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
        metadata: {
          url: message.url,
          page_title: message.title,
        },
      }),
    });

    if (response.ok) {
      // SSE stream — read and forward to sidebar
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
              // sse-starlette nested format
              if (payload.startsWith("event:")) {
                // Parse: "event: X\r\ndata: data: Y"
                continue;
              }
              if (payload.startsWith("data: ")) {
                const inner = payload.slice(6);
                const parsed = JSON.parse(inner);
                chrome.runtime.sendMessage({ target: "sidebar", ...parsed }).catch(() => {});
              } else {
                const parsed = JSON.parse(payload);
                chrome.runtime.sendMessage({ target: "sidebar", ...parsed }).catch(() => {});
              }
            } catch (e) {
              // Not JSON — token text
              chrome.runtime.sendMessage({
                target: "sidebar",
                type: "token",
                data: payload,
              }).catch(() => {});
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("Lenni HTTP fallback failed:", e);
    chrome.runtime.sendMessage({
      target: "sidebar",
      type: "error",
      data: "Cannot connect to Lenni. Is the backend running?",
    }).catch(() => {});
  }
}

// ── Context Menus ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await loadConfig();

  chrome.contextMenus.create({
    id: "ask-lenni",
    title: "Ask Lenni about this",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "explain-lenni",
    title: "Explain this",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "remember-lenni",
    title: "Remember this",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "summarise-page",
    title: "Summarise this page",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Open sidebar
  if (chrome.sidePanel) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }

  const baseMsg = {
    url: tab.url,
    title: tab.title,
  };

  switch (info.menuItemId) {
    case "ask-lenni":
      sendToLenni({
        type: "chat",
        text: `Analyse this: "${info.selectionText}"`,
        ...baseMsg,
      });
      chrome.runtime.sendMessage({
        target: "sidebar",
        type: "user_message",
        text: `Analyse this: "${info.selectionText?.slice(0, 200)}"`,
      }).catch(() => {});
      break;

    case "explain-lenni":
      sendToLenni({
        type: "chat",
        text: `Explain this in simple terms: "${info.selectionText}"`,
        ...baseMsg,
      });
      chrome.runtime.sendMessage({
        target: "sidebar",
        type: "user_message",
        text: `Explain: "${info.selectionText?.slice(0, 200)}"`,
      }).catch(() => {});
      break;

    case "remember-lenni":
      sendToLenni({
        type: "remember",
        text: info.selectionText,
        ...baseMsg,
      });
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Lenni",
        message: "Saved to memory.",
      });
      break;

    case "summarise-page":
      // Request page content from content script
      chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }, (response) => {
        if (response && response.content) {
          sendToLenni({
            type: "chat",
            text: "Summarise this page",
            page_content: response.content.slice(0, 5000),
            ...baseMsg,
          });
          chrome.runtime.sendMessage({
            target: "sidebar",
            type: "user_message",
            text: `Summarise: ${tab.title}`,
          }).catch(() => {});
        }
      });
      break;
  }
});

// ── Message handling from sidebar/popup ──────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "background") {
    switch (message.type) {
      case "send_message":
        sendToLenni({
          type: "chat",
          text: message.text,
          url: message.url,
          title: message.title,
        });
        break;

      case "get_status":
        sendResponse({
          connected: ws && ws.readyState === WebSocket.OPEN,
          url: lenniUrl,
        });
        return true;

      case "reconnect":
        connectWebSocket();
        break;

      case "config_updated":
        loadConfig().then(() => {
          if (ws) ws.close();
          connectWebSocket();
        });
        break;
    }
  }
});

// ── Startup ──────────────────────────────────────────────────────

loadConfig().then(() => {
  connectWebSocket();
});
