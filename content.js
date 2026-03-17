// content.js — Content script injected into all pages
// Handles DOM reading and page interaction triggered by the assistant

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    case 'READ_PAGE': {
      const text = readPageContent();
      // Ask background to speak via chrome.tts
      chrome.runtime.sendMessage({ type: 'SPEAK', text });
      sendResponse({ ok: true, text });
      break;
    }

    case 'GET_PAGE_INFO':
      sendResponse({
        title: document.title,
        url:   window.location.href,
        text:  readPageContent(),
        links: getLinks().slice(0, 10),
      });
      break;

    case 'SCROLL':
      window.scrollBy({
        top:      message.direction === 'down' ? 400 : -400,
        behavior: 'smooth',
      });
      sendResponse({ ok: true });
      break;

    case 'GO_BACK':
      window.history.back();
      sendResponse({ ok: true });
      break;

    case 'GO_FORWARD':
      window.history.forward();
      sendResponse({ ok: true });
      break;

    case 'RELOAD':
      window.location.reload();
      sendResponse({ ok: true });
      break;

    case 'GET_TITLE': {
      const title = document.title || 'No title found.';
      chrome.runtime.sendMessage({ type: 'SPEAK', text: `Page title: ${title}` });
      sendResponse({ ok: true, title });
      break;
    }

    case 'GET_LINKS': {
      const links = getLinks().slice(0, 8);
      const speech = links.length
        ? `Found ${links.length} links. ${links.map((l, i) => `${i + 1}: ${l.text}`).join('. ')}.`
        : 'No links found on this page.';
      chrome.runtime.sendMessage({ type: 'SPEAK', text: speech });
      sendResponse({ ok: true, links });
      break;
    }

    case 'SUMMARIZE': {
      const text = readPageContent();
      chrome.runtime.sendMessage({ type: 'SPEAK', text: `Here is a summary. ${text}` });
      sendResponse({ ok: true, text });
      break;
    }

    case 'CLICK_ELEMENT': {
      const el = document.querySelector(message.selector);
      if (el) {
        el.click();
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: `No element found for selector: ${message.selector}` });
      }
      break;
    }

    case 'FOCUS_ELEMENT': {
      const el = document.querySelector(message.selector);
      if (el) {
        el.focus();
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: `No element found for selector: ${message.selector}` });
      }
      break;
    }

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }

  return true; // keep channel open for async sendResponse
});

// ─── DOM utilities ────────────────────────────────────────────────────────────

function readPageContent() {
  // Prefer semantic landmarks; fall back to body
  const root = document.querySelector('main, article, [role="main"]') || document.body;

  const headings = [...root.querySelectorAll('h1, h2, h3')]
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  const paragraphs = [...root.querySelectorAll('p')]
    .map((el) => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 5);

  const parts = [];
  if (headings.length)   parts.push(`Headings: ${headings.join('. ')}.`);
  if (paragraphs.length) parts.push(paragraphs.join(' '));

  return parts.join(' ') || document.title || 'No readable content found on this page.';
}

function getLinks() {
  return [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: a.textContent.trim(), href: a.href }))
    .filter((l) => l.text);
}
