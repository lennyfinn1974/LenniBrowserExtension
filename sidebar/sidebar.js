/**
 * Lenni Sidebar — Chat interface in the browser side panel.
 */

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("btn-send");
const thinkingEl = document.getElementById("thinking");
const thinkingText = document.getElementById("thinking-text");
const statusDot = document.getElementById("status-dot");
const pageContextBtn = document.getElementById("btn-page-context");

let includePageContext = false;
let currentAssistantEl = null;
let isStreaming = false;

// ── Init ─────────────────────────────────────────────────────────

// Check connection status
chrome.runtime.sendMessage(
  { target: "background", type: "get_status" },
  (response) => {
    if (response) {
      statusDot.className = `status-dot ${response.connected ? "connected" : "disconnected"}`;
      statusDot.title = response.connected ? "Connected to Lenni" : "Disconnected";
    }
  }
);

// ── Page context toggle ──────────────────────────────────────────

pageContextBtn.addEventListener("click", () => {
  includePageContext = !includePageContext;
  pageContextBtn.classList.toggle("active", includePageContext);
  pageContextBtn.title = includePageContext
    ? "Page context included"
    : "Include page context";
});

// ── Input handling ───────────────────────────────────────────────

inputEl.addEventListener("input", () => {
  sendBtn.disabled = !inputEl.value.trim() || isStreaming;
  // Auto-resize
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (inputEl.value.trim() && !isStreaming) sendMessage();
  }
});

sendBtn.addEventListener("click", () => {
  if (inputEl.value.trim() && !isStreaming) sendMessage();
});

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  // Clear empty state
  const emptyState = messagesEl.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  // Add user message
  addMessage("user", text);

  // Get current tab info
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const msg = {
      target: "background",
      type: "send_message",
      text: text,
      url: tab?.url,
      title: tab?.title,
    };

    // Include page content if toggled
    if (includePageContext && tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }, (response) => {
        if (response && response.content) {
          msg.text = `[Page: ${tab.title}]\n${response.content.slice(0, 2000)}\n\n${text}`;
        }
        chrome.runtime.sendMessage(msg);
      });
    } else {
      chrome.runtime.sendMessage(msg);
    }
  });

  // Show thinking
  showThinking("Lenni is thinking...");
  isStreaming = true;
  sendBtn.disabled = true;
  currentAssistantEl = null;

  inputEl.value = "";
  inputEl.style.height = "auto";
}

// ── Message display ──────────────────────────────────────────────

function addMessage(role, content) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.innerHTML = simpleMarkdown(content);
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function showThinking(text) {
  thinkingText.textContent = text;
  thinkingEl.classList.remove("hidden");
}

function hideThinking() {
  thinkingEl.classList.add("hidden");
}

function simpleMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/### (.+)/g, "<h3>$1</h3>")
    .replace(/#### (.+)/g, "<h4>$1</h4>")
    .replace(/^- (.+)/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/\n/g, "<br>");
}

// ── Receive messages from background ─────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "sidebar") return;

  switch (message.type) {
    case "connection_status":
      statusDot.className = `status-dot ${message.connected ? "connected" : "disconnected"}`;
      statusDot.title = message.connected ? "Connected to Lenni" : "Disconnected";
      break;

    case "thinking":
      showThinking(message.data?.message || "Lenni is thinking...");
      break;

    case "token":
      hideThinking();
      if (!currentAssistantEl) {
        // Clear empty state
        const emptyState = messagesEl.querySelector(".empty-state");
        if (emptyState) emptyState.remove();
        currentAssistantEl = addMessage("assistant", "");
      }
      // Append token
      const tokenText = typeof message.data === "string" ? message.data : message.data?.text || "";
      currentAssistantEl.dataset.raw = (currentAssistantEl.dataset.raw || "") + tokenText;
      currentAssistantEl.innerHTML = simpleMarkdown(currentAssistantEl.dataset.raw);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      break;

    case "done":
      hideThinking();
      isStreaming = false;
      sendBtn.disabled = !inputEl.value.trim();
      currentAssistantEl = null;
      break;

    case "error":
      hideThinking();
      isStreaming = false;
      sendBtn.disabled = !inputEl.value.trim();
      addMessage("error", message.data || "Something went wrong.");
      currentAssistantEl = null;
      break;

    case "user_message":
      // From context menu — show what was sent
      const emptyState2 = messagesEl.querySelector(".empty-state");
      if (emptyState2) emptyState2.remove();
      addMessage("user", message.text);
      showThinking("Lenni is thinking...");
      isStreaming = true;
      break;
  }
});
