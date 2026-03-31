/**
 * Lenni Content Script — runs on every page.
 *
 * Three roles:
 *   1. Extract page metadata/content for Lenni analysis
 *   2. Show action confirmation overlays (browser control bridge)
 *   3. Highlight target elements before Lenni interacts
 */

// ── Page extraction ──────────────────────────────────────────────

function getPageMetadata() {
  const meta = (name) => {
    const el =
      document.querySelector(`meta[name="${name}"]`) ||
      document.querySelector(`meta[property="og:${name}"]`);
    return el ? el.getAttribute("content") : "";
  };

  return {
    url: window.location.href,
    title: document.title,
    description: meta("description"),
    author: meta("author"),
    published: meta("article:published_time") || meta("datePublished"),
    headings: Array.from(document.querySelectorAll("h1, h2, h3"))
      .slice(0, 20)
      .map((h) => ({ level: h.tagName, text: h.textContent.trim() })),
    wordCount: (document.body?.innerText || "").split(/\s+/).length,
  };
}

function getPageContent() {
  const main =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.body;

  if (!main) return "";

  const clone = main.cloneNode(true);
  clone
    .querySelectorAll(
      "script, style, nav, footer, header, aside, .ad, .advertisement, [role='navigation']"
    )
    .forEach((el) => el.remove());

  let text = clone.innerText || clone.textContent || "";
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text.slice(0, 5000);
}

function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : "";
}

// ── Action confirmation overlay ──────────────────────────────────

let activeConfirmation = null;

function showConfirmation(actionId, description, target, url, tier) {
  removeConfirmation();

  const isDestructive = tier === "destructive";

  const overlay = document.createElement("div");
  overlay.className = `lenni-confirmation-overlay${isDestructive ? " destructive" : ""}`;
  overlay.id = "lenni-confirmation";
  overlay.innerHTML = `
    <div class="lenni-confirmation-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
      </svg>
      ${isDestructive ? "Lenni wants to (requires confirmation):" : "Lenni wants to:"}
    </div>
    <div class="lenni-confirmation-body">
      <div class="action-desc">${escapeHtml(description)}</div>
      <div class="action-target">${escapeHtml(url || target || "")}</div>
    </div>
    <div class="lenni-confirmation-actions">
      <button class="lenni-btn-allow" data-action="allow">Allow</button>
      <button class="lenni-btn-deny" data-action="deny">Deny</button>
      <button class="lenni-btn-allow-site" data-action="allow_site">Allow All (Site)</button>
    </div>
  `;

  overlay.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      chrome.runtime.sendMessage({
        target: "background",
        type: "action_confirmation",
        action_id: actionId,
        approved: action === "allow" || action === "allow_site",
        allow_site: action === "allow_site",
      });
      removeConfirmation();
      removeHighlight();
    });
  });

  document.body.appendChild(overlay);
  activeConfirmation = overlay;
}

function removeConfirmation() {
  if (activeConfirmation) {
    activeConfirmation.remove();
    activeConfirmation = null;
  }
  const existing = document.getElementById("lenni-confirmation");
  if (existing) existing.remove();
}

// ── Element highlighting ─────────────────────────────────────────

let highlightedElement = null;

function highlightElement(selector, tier) {
  removeHighlight();
  try {
    const el = document.querySelector(selector);
    if (el) {
      const cls = tier === "destructive" ? "lenni-highlight-destructive" : "lenni-highlight";
      el.classList.add(cls);
      highlightedElement = { el, cls };
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (e) {
    // Invalid selector — ignore
  }
}

function removeHighlight() {
  if (highlightedElement) {
    highlightedElement.el.classList.remove(highlightedElement.cls);
    highlightedElement = null;
  }
}

// ── Toast notification ───────────────────────────────────────────

function showToast(message, duration = 3000) {
  const existing = document.querySelector(".lenni-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "lenni-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── Message handling ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "getPageMetadata":
      sendResponse(getPageMetadata());
      return true;

    case "getPageContent":
      sendResponse({ content: getPageContent(), metadata: getPageMetadata() });
      return true;

    case "getSelectedText":
      sendResponse({ text: getSelectedText() });
      return true;

    case "getPageContext":
      const metadata = getPageMetadata();
      const content = getPageContent();
      sendResponse({ ...metadata, content: content.slice(0, 2000), fullContent: content });
      return true;

    // ── Browser control bridge ──
    case "showConfirmation":
      showConfirmation(
        message.actionId,
        message.description,
        message.target,
        message.url,
        message.tier
      );
      return true;

    case "highlightElement":
      highlightElement(message.selector, message.tier);
      return true;

    case "removeHighlight":
      removeHighlight();
      removeConfirmation();
      return true;

    case "showToast":
      showToast(message.text, message.duration);
      return true;
  }
});

// ── Helpers ──────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Notify background
chrome.runtime.sendMessage({
  target: "background",
  type: "content_script_ready",
  url: window.location.href,
}).catch(() => {});
