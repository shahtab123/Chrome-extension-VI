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

    case 'TOGGLE_HIGH_CONTRAST': {
      const id = '__va_high_contrast_style__';
      const existing = document.getElementById(id);
      if (existing) {
        existing.remove();
        sendResponse({ ok: true, enabled: false });
      } else {
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
          html { filter: contrast(1.35) grayscale(0.1) !important; }
          body, p, span, div, section, article { color: #fff !important; background: #000 !important; }
          a { color: #8ec5ff !important; text-decoration: underline !important; }
          button, input, textarea, select { background: #111 !important; color: #fff !important; border: 2px solid #fff !important; }
        `;
        document.head.appendChild(style);
        sendResponse({ ok: true, enabled: true });
      }
      break;
    }

    case 'INCREASE_TEXT_SIZE': {
      const current = Number(document.documentElement.dataset.vaTextScale || '1');
      const next = Math.min(2, Number((current + 0.1).toFixed(2)));
      document.documentElement.dataset.vaTextScale = String(next);
      document.documentElement.style.fontSize = `${next * 100}%`;
      sendResponse({ ok: true, scale: next });
      break;
    }

    case 'TOGGLE_FOCUS_HIGHLIGHT': {
      const id = '__va_focus_highlight_style__';
      const existing = document.getElementById(id);
      if (existing) {
        existing.remove();
        sendResponse({ ok: true, enabled: false });
      } else {
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
          *:focus, *:focus-visible {
            outline: 3px solid #ffd54f !important;
            outline-offset: 2px !important;
            box-shadow: 0 0 0 3px rgba(255, 213, 79, 0.35) !important;
          }
        `;
        document.head.appendChild(style);
        sendResponse({ ok: true, enabled: true });
      }
      break;
    }

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
      const el = message.selector
        ? document.querySelector(message.selector)
        : null;
      if (el) {
        el.click();
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: `No element found for selector: ${message.selector}` });
      }
      break;
    }

    case 'FOCUS_ELEMENT': {
      const el = message.selector
        ? document.querySelector(message.selector)
        : null;
      if (el) {
        el.focus();
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: `No element found for selector: ${message.selector}` });
      }
      break;
    }

    // ── Page interaction: type, click by text, search, press key ──────────

    case 'TYPE_INTO_INPUT': {
      const input = findBestInput();
      if (!input) {
        sendResponse({ error: 'no-input', message: 'Could not find an input field on this page.' });
        break;
      }
      typeIntoElement(input, message.text || '');
      sendResponse({ ok: true, target: describeElement(input) });
      break;
    }

    case 'SEARCH_PAGE': {
      const input = findBestInput();
      if (!input) {
        sendResponse({ error: 'no-input', message: 'Could not find a search field on this page.' });
        break;
      }
      typeIntoElement(input, message.text || '');
      submitInput(input);
      sendResponse({ ok: true, target: describeElement(input) });
      break;
    }

    case 'PRESS_ENTER': {
      const focused = document.activeElement;
      if (focused && focused !== document.body) {
        submitInput(focused);
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'Nothing is focused to press enter on.' });
      }
      break;
    }

    case 'FOCUS_SEARCH': {
      const input = findBestInput();
      if (!input) {
        sendResponse({ error: 'no-input', message: 'Could not find a search field on this page.' });
        break;
      }
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sendResponse({ ok: true, target: describeElement(input) });
      break;
    }

    case 'CLEAR_INPUT': {
      const input = findBestInput() || document.activeElement;
      if (input && isInputLike(input)) {
        setNativeValue(input, '');
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'No input field to clear.' });
      }
      break;
    }

    case 'CLICK_BY_TEXT': {
      const result = clickByText(message.text);
      sendResponse(result);
      break;
    }

    case 'GET_FORM_FIELDS': {
      const fields = getFormFields();
      sendResponse({ ok: true, fields });
      break;
    }

    case 'SIMULATE_KEY': {
      simulateKey(message.key, { shift: message.shift });
      sendResponse({ ok: true });
      break;
    }

    // ── Headings navigation ────────────────────────────────────────────────

    case 'GET_HEADINGS': {
      const headings = getVisibleHeadings();
      currentHeadingIdx = -1;
      if (!headings.length) {
        sendResponse({ ok: false, message: 'No headings found on this page.' });
      } else {
        const list = headings.map((h, i) => `${i + 1}: ${h.text}`).join('. ');
        sendResponse({ ok: true, count: headings.length, list });
      }
      break;
    }

    case 'NEXT_HEADING': {
      const headings = getVisibleHeadings();
      if (!headings.length) { sendResponse({ error: 'No headings on this page.' }); break; }
      currentHeadingIdx = Math.min(currentHeadingIdx + 1, headings.length - 1);
      scrollToHeading(headings[currentHeadingIdx].el);
      sendResponse({ ok: true, text: headings[currentHeadingIdx].text, index: currentHeadingIdx, total: headings.length });
      break;
    }

    case 'PREV_HEADING': {
      const headings = getVisibleHeadings();
      if (!headings.length) { sendResponse({ error: 'No headings on this page.' }); break; }
      currentHeadingIdx = Math.max(currentHeadingIdx - 1, 0);
      scrollToHeading(headings[currentHeadingIdx].el);
      sendResponse({ ok: true, text: headings[currentHeadingIdx].text, index: currentHeadingIdx, total: headings.length });
      break;
    }

    case 'GO_TO_HEADING': {
      const headings = getVisibleHeadings();
      const idx = (message.index ?? 1) - 1;
      if (!headings.length) { sendResponse({ error: 'No headings on this page.' }); break; }
      if (idx < 0 || idx >= headings.length) { sendResponse({ error: `Only ${headings.length} heading${headings.length === 1 ? '' : 's'} on this page.` }); break; }
      currentHeadingIdx = idx;
      scrollToHeading(headings[idx].el);
      sendResponse({ ok: true, text: headings[idx].text, index: idx, total: headings.length });
      break;
    }

    case 'FIND_HEADING': {
      const headings = getVisibleHeadings();
      if (!headings.length) { sendResponse({ error: 'No headings on this page.' }); break; }
      const query = (message.query || '').toLowerCase();
      const match = headings.find(h => h.text.toLowerCase().includes(query));
      if (!match) { sendResponse({ error: `No heading matching "${message.query}" found.` }); break; }
      currentHeadingIdx = headings.indexOf(match);
      scrollToHeading(match.el);
      sendResponse({ ok: true, text: match.text, index: currentHeadingIdx, total: headings.length });
      break;
    }

    case 'YT_CONTROL': {
      const video = document.querySelector('video');
      if (!video) {
        sendResponse({ error: 'No video found on this page.' });
        break;
      }
      const action = message.action;
      switch (action) {
        case 'play':
          video.play();
          sendResponse({ ok: true });
          break;
        case 'pause':
          video.pause();
          sendResponse({ ok: true });
          break;
        case 'toggle':
          if (video.paused) video.play(); else video.pause();
          sendResponse({ ok: true, playing: !video.paused });
          break;
        case 'seek_start':
          video.currentTime = 0;
          if (video.paused) video.play();
          sendResponse({ ok: true });
          break;
        case 'seek':
          video.currentTime = Math.max(0, video.currentTime + (message.delta || 0));
          sendResponse({ ok: true, time: Math.round(video.currentTime) });
          break;
        case 'seek_pct': {
          const pct = message.percent || 0;
          video.currentTime = (video.duration || 0) * (pct / 100);
          sendResponse({ ok: true, time: Math.round(video.currentTime) });
          break;
        }
        case 'mute':
          video.muted = !video.muted;
          sendResponse({ ok: true, muted: video.muted });
          break;
        case 'volume': {
          const newVol = Math.min(1, Math.max(0, video.volume + (message.delta || 0)));
          video.volume = newVol;
          sendResponse({ ok: true, volume: Math.round(newVol * 100) });
          break;
        }
        case 'speed': {
          const newRate = Math.min(4, Math.max(0.25, video.playbackRate + (message.delta || 0)));
          video.playbackRate = newRate;
          sendResponse({ ok: true, speed: newRate });
          break;
        }
        case 'status':
          sendResponse({
            ok: true,
            paused: video.paused,
            time: Math.round(video.currentTime),
            duration: Math.round(video.duration || 0),
            volume: Math.round(video.volume * 100),
            muted: video.muted,
            speed: video.playbackRate,
          });
          break;
        default:
          sendResponse({ error: `Unknown YT action: ${action}` });
      }
      break;
    }

    case 'LIST_MEDIA': {
      // YouTube loads content dynamically — retry until items appear or timeout
      waitForMediaItems(1500).then((items) => {
        const serializable = items.map(({ el, ...rest }) => rest);
        sendResponse({ ok: true, items: serializable });
      });
      return true; // keep channel open for async response
    }

    case 'CLICK_MEDIA_N': {
      waitForMediaItems(1500).then((items) => {
        const n = message.index; // 0-based
        if (n < 0 || n >= items.length) {
          sendResponse({ error: `There are ${items.length} items. Number ${n + 1} does not exist.` });
          return;
        }
        const target = items[n];
        // Return the URL so the caller can navigate via background script
        sendResponse({ ok: true, title: target.title, url: target.url || '' });
      });
      return true; // keep channel open for async response
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

// ─── Page interaction utilities ──────────────────────────────────────────────

const INPUT_SELECTORS = [
  'input[type="search"]',
  'input[name="q"]',
  'input[name="search"]',
  'input[name="query"]',
  'input[name="search_query"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  'input[aria-label*="earch" i]',
  'input[placeholder*="earch" i]',
  'input[title*="earch" i]',
  'textarea[aria-label*="earch" i]',
  'textarea[placeholder*="earch" i]',
  'input[type="text"]',
  'input:not([type])',
  'textarea',
  '[contenteditable="true"]',
];

function isInputLike(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute('role') === 'textbox') return true;
  if (el.getAttribute('role') === 'searchbox') return true;
  if (el.getAttribute('role') === 'combobox') return true;
  return false;
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function findBestInput() {
  // If the user already focused an input, prefer it
  const active = document.activeElement;
  if (active && isInputLike(active) && active !== document.body) return active;

  for (const selector of INPUT_SELECTORS) {
    const candidates = document.querySelectorAll(selector);
    for (const el of candidates) {
      if (isVisible(el) && !el.disabled && !el.readOnly) return el;
    }
  }
  return null;
}

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function typeIntoElement(el, text) {
  el.focus();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    setNativeValue(el, text);
  }
}

function submitInput(el) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

  // Also try submitting the parent form if one exists
  const form = el.closest('form');
  if (form) {
    form.requestSubmit?.() ?? form.submit();
  }
}

function describeElement(el) {
  const label = el.getAttribute('aria-label')
    || el.getAttribute('placeholder')
    || el.getAttribute('title')
    || el.getAttribute('name')
    || el.tagName.toLowerCase();
  return label;
}

function clickByText(text) {
  if (!text) return { error: 'No text to search for.' };
  const lower = text.toLowerCase().trim();

  // Search buttons first, then links, then any clickable element
  const candidates = [
    ...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'),
    ...document.querySelectorAll('a'),
    ...document.querySelectorAll('[onclick], [tabindex]'),
  ];

  let bestMatch = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const elText = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').trim().toLowerCase();
    if (!elText) continue;

    if (elText === lower) {
      bestMatch = el;
      bestScore = 0;
      break;
    }
    if (elText.includes(lower) && elText.length < bestScore) {
      bestMatch = el;
      bestScore = elText.length;
    }
  }

  if (bestMatch) {
    bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bestMatch.click();
    return { ok: true, clicked: bestMatch.textContent?.trim().slice(0, 60) || 'element' };
  }
  return { error: `Could not find anything matching "${text}" on this page.` };
}

function simulateKey(key, { shift = false } = {}) {
  // Ensure no input is focused — YouTube player shortcuts only work on the body/video
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }

  // Build the correct `code` property for the key
  const KEY_CODES = {
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ' ': { code: 'Space', keyCode: 32 },
    '/': { code: 'Slash', keyCode: 191 },
    '.': { code: 'Period', keyCode: 190 },
    ',': { code: 'Comma', keyCode: 188 },
    '>': { code: 'Period', keyCode: 190 },
    '<': { code: 'Comma', keyCode: 188 },
  };

  let code, keyCode;
  if (KEY_CODES[key]) {
    code = KEY_CODES[key].code;
    keyCode = KEY_CODES[key].keyCode;
  } else if (key.length === 1 && key >= '0' && key <= '9') {
    code = `Digit${key}`;
    keyCode = key.charCodeAt(0);
  } else {
    code = `Key${key.toUpperCase()}`;
    keyCode = key.toUpperCase().charCodeAt(0);
  }

  const opts = { key, code, keyCode, which: keyCode, shiftKey: shift, bubbles: true, cancelable: true };

  document.dispatchEvent(new KeyboardEvent('keydown', opts));
  document.dispatchEvent(new KeyboardEvent('keypress', opts));
  document.dispatchEvent(new KeyboardEvent('keyup', opts));
}

function getFormFields() {
  const fields = [];
  const inputs = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
  for (const el of inputs) {
    if (!isVisible(el)) continue;
    fields.push({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      label: describeElement(el),
      value: el.value?.slice(0, 50) || '',
    });
    if (fields.length >= 15) break;
  }
  return fields;
}

// ─── Media / video list detection ────────────────────────────────────────────
// Returns an ordered array of { title, channel, duration, url, el } for the
// current page. Works on YouTube (search, home, channel, playlist) and falls
// back to generic link detection for other sites.

// Polls for media items with retries — YouTube renders content dynamically
function waitForMediaItems(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    function attempt() {
      const items = getMediaItems();
      if (items.length > 0 || Date.now() - start > timeoutMs) {
        resolve(items);
        return;
      }
      setTimeout(attempt, 300);
    }
    attempt();
  });
}

function getMediaItems() {
  const host = location.hostname.replace('www.', '');

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    return getYouTubeItems();
  }

  return getGenericMediaItems();
}

function getYouTubeItems() {
  const seen = new Set();
  const items = [];

  function addItem(el, title, href) {
    if (!title || title.length < 3 || !href || seen.has(href)) return;
    // Normalize URL to deduplicate — strip timestamp params
    const cleanHref = href.split('&t=')[0];
    if (seen.has(cleanHref)) return;
    seen.add(cleanHref);
    seen.add(href);

    const renderer = el.closest(
      'ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ' +
      'ytd-playlist-video-renderer, ytd-reel-item-renderer, ytd-grid-video-renderer, ' +
      'ytd-rich-grid-media, ytd-playlist-panel-video-renderer'
    );

    let channel = '';
    let duration = '';
    if (renderer) {
      const chEl = renderer.querySelector(
        '#channel-name a, #channel-name yt-formatted-string, ' +
        'ytd-channel-name a, ytd-channel-name yt-formatted-string, ' +
        '#byline a, #metadata a, [class*="byline"] a'
      );
      channel = chEl?.textContent?.trim() || '';

      const durEl = renderer.querySelector(
        'ytd-thumbnail-overlay-time-status-renderer span, ' +
        '#overlays span[aria-label], ' +
        'badge-shape .badge-shape-wiz__text, ' +
        '[class*="time-status"] span'
      );
      duration = durEl?.textContent?.trim() || '';
    }

    items.push({ title, channel, duration, url: href, el });
  }

  // Strategy 1: Search results — ytd-video-renderer contains a#video-title
  const searchResults = document.querySelectorAll('#contents > ytd-video-renderer');
  for (const renderer of searchResults) {
    const titleEl = renderer.querySelector('a#video-title');
    if (titleEl) {
      addItem(titleEl, titleEl.textContent?.trim(), titleEl.href);
      if (items.length >= 20) return items;
    }
  }

  // Strategy 2: Home/feed — ytd-rich-item-renderer / ytd-rich-grid-media
  if (items.length === 0) {
    const homeItems = document.querySelectorAll(
      'ytd-rich-item-renderer, ytd-rich-grid-media, ytd-grid-video-renderer'
    );
    for (const renderer of homeItems) {
      const titleEl = renderer.querySelector('#video-title-link, #video-title, a#video-title');
      const link = titleEl?.closest('a') || titleEl || renderer.querySelector('a[href*="/watch"]');
      if (!link) continue;
      const title = titleEl?.textContent?.trim() || link.getAttribute('title') || '';
      addItem(link, title, link.href);
      if (items.length >= 20) return items;
    }
  }

  // Strategy 3: Sidebar / playlist / compact renderers
  if (items.length === 0) {
    const sideItems = document.querySelectorAll(
      'ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer'
    );
    for (const renderer of sideItems) {
      const titleEl = renderer.querySelector('#video-title, span#video-title');
      const link = renderer.querySelector('a[href*="/watch"]');
      if (!link) continue;
      const title = titleEl?.textContent?.trim() || link.getAttribute('title') || '';
      addItem(link, title, link.href);
      if (items.length >= 20) return items;
    }
  }

  // Strategy 4: yt-formatted-string based (newer YouTube builds)
  if (items.length === 0) {
    const fmtStrings = document.querySelectorAll('yt-formatted-string.ytd-rich-grid-media');
    for (const el of fmtStrings) {
      const link = el.closest('a') || el.parentElement?.closest('a');
      if (!link?.href) continue;
      addItem(link, el.innerText?.trim(), link.href);
      if (items.length >= 20) return items;
    }
  }

  // Strategy 5: Broadest fallback — any <a> with href containing /watch?v= that has a title attribute
  if (items.length === 0) {
    const watchLinks = document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]');
    for (const el of watchLinks) {
      const title = el.getAttribute('title')
        || el.getAttribute('aria-label')
        || el.textContent?.trim();
      if (!title || title.length < 3 || title.length > 300) continue;
      addItem(el, title, el.href);
      if (items.length >= 20) return items;
    }
  }

  return items;
}

function getGenericMediaItems() {
  const items = [];
  // Look for prominent links with thumbnails or heading-level text
  const links = document.querySelectorAll('a[href]');
  for (const el of links) {
    if (!isVisible(el)) continue;
    const title = el.textContent?.trim();
    if (!title || title.length < 5 || title.length > 200) continue;
    // Skip navigation/footer links — prefer links with images or inside article/section
    const parent = el.closest('article, section, [role="listitem"], li, .card, .item');
    if (!parent) continue;
    items.push({ title, channel: '', duration: '', url: el.href, el });
    if (items.length >= 15) break;
  }
  return items;
}

// ─── Headings helpers ─────────────────────────────────────────────────────────

let currentHeadingIdx = -1;

function getVisibleHeadings() {
  return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(el => {
      if (!el.textContent.trim()) return false;
      // Check element is visible (not hidden)
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
    })
    .map(el => ({ el, text: el.textContent.trim().replace(/\s+/g, ' '), level: parseInt(el.tagName[1]) }));
}

function scrollToHeading(el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Make focusable and focus for screen-reader compatibility
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}
