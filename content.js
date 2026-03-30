/**
 * Lenni Content Script — runs on every page.
 *
 * Extracts page metadata and content for Lenni's page analysis features.
 * Responds to requests from background script and sidebar.
 */

// ── Page metadata extraction ─────────────────────────────────────

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
  // Get main content, preferring <article> or <main>
  const main =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.body;

  if (!main) return "";

  // Clone and remove scripts, styles, nav, footer
  const clone = main.cloneNode(true);
  clone
    .querySelectorAll("script, style, nav, footer, header, aside, .ad, .advertisement, [role='navigation']")
    .forEach((el) => el.remove());

  // Get clean text
  let text = clone.innerText || clone.textContent || "";

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  // Limit to ~5000 chars
  return text.slice(0, 5000);
}

function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : "";
}

// ── Message handling ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "getPageMetadata":
      sendResponse(getPageMetadata());
      return true;

    case "getPageContent":
      sendResponse({
        content: getPageContent(),
        metadata: getPageMetadata(),
      });
      return true;

    case "getSelectedText":
      sendResponse({ text: getSelectedText() });
      return true;

    case "getPageContext":
      // Full context for sidebar — metadata + content summary
      const metadata = getPageMetadata();
      const content = getPageContent();
      sendResponse({
        ...metadata,
        content: content.slice(0, 2000),
        fullContent: content,
      });
      return true;
  }
});

// ── Notify background that content script is loaded ──────────────

chrome.runtime.sendMessage({
  target: "background",
  type: "content_script_ready",
  url: window.location.href,
}).catch(() => {});
