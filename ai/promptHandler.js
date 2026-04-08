// ai/promptHandler.js
// Command routing — four layers, in priority order:
//
//   1. Chrome API queries     — chrome.tabs, storage, Date — instant, no AI
//   2. Page actions           — tell content script to act on the active page
//   3. Chrome Built-in AI     — Gemini Nano on-device (if available, future use)
//   4. Gemini API (cloud)     — free tier, requires API key in settings
//
// Falls back gracefully when a layer is unavailable.

import { callGemini, getApiKey, draftEmailWithAI } from './geminiApi.js';
import { getUserProfile, getSessionHistory, addProfileFact } from './memory.js';
import {
  getAuthToken, removeCachedToken, isGmailConnected,
  listUnread, listMessages, getMessage, replyToMessage,
  sendEmail, markAsRead, markAsUnread, archiveMessage, trashMessage,
  starMessage, unstarMessage, markImportant, markNotImportant,
  getUnreadCount, listMessageIds, extractName,
} from '../browser/gmail.js';

function isGmailAuthError(err) {
  const m = err.message ?? '';
  return m.includes('not granted') || m.includes('OAuth2') || m.includes('No auth') ||
         m.includes('interaction required') || m.includes('Authorization') || m.includes('sign in');
}

const GMAIL_SIGNIN_MSG =
  'A Google sign-in window has opened. Please complete sign-in — you will only need to do this once.';

let aiSession = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True if `lower` contains ALL of the given words (order-independent). */
function has(lower, ...words) {
  return words.every((w) => lower.includes(w));
}

/** True if `lower` contains ANY of the given words/phrases. */
function any(lower, ...words) {
  return words.some((w) => lower.includes(w));
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function sendRuntime(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

function sendToContent(payload) {
  return sendRuntime({ type: 'SEND_TO_CONTENT', payload });
}

function formatMediaPage(items, startIndex) {
  return items.map((v, i) => {
    const num = startIndex + i + 1;
    let line = `${num}: ${v.title}`;
    if (v.channel) line += `, by ${v.channel}`;
    if (v.duration) line += `, ${v.duration}`;
    return line;
  }).join('. ');
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? '';
}

function siteFromUrl(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

// URL-based search templates — much more reliable than DOM injection on SPAs
const SITE_SEARCH_URLS = {
  'youtube.com':    (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  'google.com':     (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  'bing.com':       (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  'duckduckgo.com': (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  'wikipedia.org':  (q) => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}`,
  'amazon.com':     (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  'reddit.com':     (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
  'github.com':     (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  'twitter.com':    (q) => `https://twitter.com/search?q=${encodeURIComponent(q)}`,
  'x.com':          (q) => `https://x.com/search?q=${encodeURIComponent(q)}`,
  'ebay.com':       (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  'netflix.com':    (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
  'spotify.com':    (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
};

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function handleCommand(text) {
  const lower = text.toLowerCase().trim();

  // Layer 1 — Chrome API (tabs, time, memory, navigation)
  const apiResponse = await tryChromAPIQuery(lower);
  if (apiResponse !== null) return apiResponse;

  // Layer 2 — Page actions (read, scroll, links, etc.)
  const actionResponse = tryPageAction(lower);
  if (actionResponse !== null) return actionResponse;

  // Layer 3 — Chrome Built-in AI (Gemini Nano, on-device)
  if (await isBuiltInAIAvailable()) return runBuiltInAIPrompt(text);

  // Layer 4 — Gemini API (cloud, free tier)
  const apiKey = await getApiKey();
  if (apiKey) {
    try {
      return await callGemini(text);
    } catch (err) {
      return `AI error: ${err.message}`;
    }
  }

  return `I heard: "${text}". No AI is configured — add a Gemini API key in settings for open-ended questions.`;
}

// ─── Layer 1: Chrome API queries ─────────────────────────────────────────────

async function tryChromAPIQuery(lower) {
  // ── Read controls (TTS playback) ───────────────────────────────────────────
  if (any(lower, 'pause reading', 'pause voice', 'pause speaking', 'pause')) {
    await sendRuntime({ type: 'PAUSE_SPEAKING' });
    return { text: 'Paused.', skipSpeak: true };
  }

  if (any(lower, 'resume reading', 'resume voice', 'resume speaking', 'continue reading', 'continue')) {
    await sendRuntime({ type: 'RESUME_SPEAKING' });
    return { text: 'Resumed.', skipSpeak: true };
  }

  if (any(lower, 'stop reading', 'stop voice', 'stop speaking', 'mute voice')) {
    await sendRuntime({ type: 'STOP_SPEAKING' });
    return { text: 'Stopped reading.', skipSpeak: true };
  }

  if (any(lower, 'read slower', 'speak slower', 'slow down voice', 'slower')) {
    const { ttsRate = 1.0 } = await chrome.storage.local.get('ttsRate');
    const next = Math.max(0.6, Number((ttsRate - 0.15).toFixed(2)));
    await chrome.storage.local.set({ ttsRate: next });
    return `Reading speed set to ${next}x.`;
  }

  if (any(lower, 'read faster', 'speak faster', 'speed up voice', 'faster')) {
    const { ttsRate = 1.0 } = await chrome.storage.local.get('ttsRate');
    const next = Math.min(2.0, Number((ttsRate + 0.15).toFixed(2)));
    await chrome.storage.local.set({ ttsRate: next });
    return `Reading speed set to ${next}x.`;
  }

  // ── How many tabs ──────────────────────────────────────────────────────────
  if (
    any(lower, 'how many tabs', 'number of tabs', 'tab count', 'tabs open', 'tabs do i have', 'tabs are open', 'tabs are there')
  ) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return `You have ${tabs.length} tab${tabs.length === 1 ? '' : 's'} open.`;
  }

  // ── List all tabs ──────────────────────────────────────────────────────────
  if (
    any(lower, 'list tabs', 'list my tabs', 'list all tabs', 'show tabs', 'show my tabs', 'what tabs') ||
    (has(lower, 'tabs') && any(lower, 'list', 'show', 'tell me'))
  ) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const names = tabs.map((t, i) => `${i + 1}: ${t.title || t.url}`).join('. ');
    return `You have ${tabs.length} tabs open. ${names}.`;
  }

  // ── Go to tab by number ────────────────────────────────────────────────────
  const goToTabMatch = lower.match(/(?:go to|switch to|open)\s+tab\s+(\d{1,3})/);
  if (goToTabMatch) {
    const tabNo = Number(goToTabMatch[1]);
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabNo < 1 || tabNo > tabs.length) {
      return `You have ${tabs.length} tabs. Tab ${tabNo} does not exist.`;
    }
    const target = tabs[tabNo - 1];
    await chrome.tabs.update(target.id, { active: true });
    return `Switched to tab ${tabNo}.`;
  }

  // ── Next / previous tab ────────────────────────────────────────────────────
  if (any(lower, 'next tab')) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const [active] = await chrome.tabs.query({ currentWindow: true, active: true });
    if (!active || !tabs.length) return 'No active tab found.';
    const idx = tabs.findIndex((t) => t.id === active.id);
    const next = tabs[(idx + 1) % tabs.length];
    await chrome.tabs.update(next.id, { active: true });
    return 'Switched to next tab.';
  }

  if (any(lower, 'previous tab', 'prev tab', 'back tab')) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const [active] = await chrome.tabs.query({ currentWindow: true, active: true });
    if (!active || !tabs.length) return 'No active tab found.';
    const idx = tabs.findIndex((t) => t.id === active.id);
    const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
    await chrome.tabs.update(prev.id, { active: true });
    return 'Switched to previous tab.';
  }

  // ── Close all other tabs ───────────────────────────────────────────────────
  if (any(lower, 'close all other tabs', 'close other tabs', 'keep only this tab')) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const [active] = await chrome.tabs.query({ currentWindow: true, active: true });
    if (!active) return 'No active tab found.';
    const ids = tabs.filter((t) => t.id !== active.id).map((t) => t.id);
    if (!ids.length) return 'No other tabs to close.';
    await chrome.tabs.remove(ids);
    return `Closed ${ids.length} other tab${ids.length === 1 ? '' : 's'}.`;
  }

  // ── Find tab with keyword ──────────────────────────────────────────────────
  const findTabMatch = lower.match(/(?:find|switch to|go to)\s+tab\s+(?:with|called|named)\s+(.+)/);
  if (findTabMatch) {
    const q = findTabMatch[1].trim();
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const hit = tabs.find((t) =>
      (t.title ?? '').toLowerCase().includes(q) ||
      (t.url ?? '').toLowerCase().includes(q)
    );
    if (!hit) return `I couldn't find a tab with ${q}.`;
    await chrome.tabs.update(hit.id, { active: true });
    return `Switched to tab with ${q}.`;
  }

  // ── What page / site / tab am I on ────────────────────────────────────────
  if (
    any(lower, 'what page', 'which page', 'what site', 'which site', 'what tab', 'which tab') ||
    any(lower, 'where am i', 'what am i looking at', 'what is this page', 'what is this site', 'what is this tab') ||
    any(lower, 'current page', 'current tab', 'current site') ||
    (has(lower, 'page') && any(lower, 'am i', 'i am', 'i\'m', 'are we', 'we are'))
  ) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab
      ? `You are on: ${tab.title}. URL: ${tab.url}.`
      : 'Could not get the current tab.';
  }

  // ── New blank tab — check BEFORE url matching so "open a new tab" doesn't try to navigate ──
  if (
    any(lower, 'open a new tab', 'open new tab', 'new blank tab') ||
    (any(lower, 'new tab') && !lower.match(/\.[a-z]{2,}/))
  ) {
    chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: 'chrome://newtab/' });
    return 'Opening a new tab.';
  }

  // ── Navigate to a URL — catches many natural phrasings ────────────────────
  // Trigger words: go to, open, navigate, take me, type, visit, browse, load, search for
  const gotoMatch = lower.match(
    /(?:go to|open|navigate to|take me to|type|visit|browse to|load|search for)\s+([a-z0-9][\w\-.]*\.[a-z]{2,}[\w/?=&#%]*)/
  );
  if (gotoMatch) {
    let url = gotoMatch[1].trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    // Navigate current tab (don't open a new one)
    chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url });
    return `Navigating to ${url}.`;
  }

  // ── Close tab ─────────────────────────────────────────────────────────────
  if (
    any(lower, 'close tab', 'close this tab', 'close current tab', 'close the tab') ||
    (has(lower, 'close') && has(lower, 'tab'))
  ) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.tabs.remove(tab.id);
    return 'Closing this tab.';
  }

  // ── Memory: save name ─────────────────────────────────────────────────────
  const nameMatch = lower.match(/(?:remember|my name is|call me|i am|i'm)\s+(?:my name is\s+)?([a-z][a-z\s]{1,30})/);
  if (nameMatch && any(lower, 'remember', 'name is', 'call me')) {
    const name = capitalise(nameMatch[1].trim());
    await chrome.storage.local.set({ userName: name });
    await addProfileFact(`My name is ${name}`);
    return `Got it! I will remember your name is ${name}.`;
  }

  // ── Memory: recall name ───────────────────────────────────────────────────
  if (
    any(lower, 'what is my name', "what's my name", 'do you know my name', 'who am i', 'my name') &&
    !lower.includes('remember')
  ) {
    const { userName } = await chrome.storage.local.get('userName');
    return userName
      ? `Your name is ${userName}.`
      : "I don't know your name yet. Say: remember my name is, followed by your name.";
  }

  // ── Memory: what do you know about me ─────────────────────────────────────
  if (any(lower, 'what do you know about me', 'what have you learned', 'my profile', 'what do you remember')) {
    const profile = await getUserProfile();
    if (!profile.length) return "I haven't learned anything about you yet. Just talk to me and I will pick things up over time.";
    const facts = profile.map((p) => p.fact).join('. ');
    return `Here is what I know about you: ${facts}.`;
  }

  // ── Memory: show saved pages ──────────────────────────────────────────────
  if (any(lower, 'saved pages', 'my saved pages', 'remembered pages', 'my bookmarks', 'show saved pages')) {
    const { savedPages = [] } = await chrome.storage.local.get('savedPages');
    if (!savedPages.length) return 'You have no saved pages yet. Say "remember this page" to save the current one.';
    const list = savedPages.slice(0, 10).map((p, i) => `${i + 1}: ${p.title}`).join('. ');
    return `You have ${savedPages.length} saved page${savedPages.length === 1 ? '' : 's'}. ${list}.`;
  }

  // ── Memory: show history summary ──────────────────────────────────────────
  if (any(lower, 'conversation history', 'show history', 'my history', 'session history')) {
    const history = await getSessionHistory();
    if (!history.length) return 'No conversation history yet.';
    const recent = history.slice(-5);
    const list = recent.map((h, i) => `${i + 1}: You asked "${h.question}"`).join('. ');
    return `I have ${history.length} turns saved. Recent ones: ${list}.`;
  }

  // ── Memory: forget ────────────────────────────────────────────────────────
  if (any(lower, 'forget everything', 'forget my name', 'clear memory', 'reset memory', 'delete everything')) {
    await chrome.storage.local.remove(['userName', 'userProfile', 'sessionHistory', 'lastQuestion', 'lastResponse', 'savedPages']);
    return 'Done. I have cleared all your personal data and conversation history.';
  }

  // ── Memory: clear profile only ────────────────────────────────────────────
  if (any(lower, 'forget about me', 'clear my profile', 'delete my profile', 'erase my data')) {
    await chrome.storage.local.remove(['userName', 'userProfile']);
    return 'Done. I have cleared your profile information.';
  }

  // ── Session memory ─────────────────────────────────────────────────────────
  if (any(lower, 'remember this page', 'save this page', 'bookmark this page')) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return 'I could not read this page.';
    const { savedPages = [] } = await chrome.storage.local.get('savedPages');
    const filtered = savedPages.filter((p) => p.url !== tab.url);
    filtered.unshift({
      title: tab.title || tab.url,
      url: tab.url,
      savedAt: Date.now(),
    });
    await chrome.storage.local.set({ savedPages: filtered.slice(0, 50) });
    return `Saved this page: ${tab.title || tab.url}.`;
  }

  if (any(lower, 'what did i ask before', 'what did i ask', 'last question', 'previous question')) {
    const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
    if (!sessionHistory.length) return 'You have not asked anything yet in this session.';
    const last = sessionHistory[sessionHistory.length - 1];
    return `Your last question was: ${last.question}`;
  }

  if (any(lower, 'read last response', 'repeat that', 'say that again', 'repeat response')) {
    const { lastResponse } = await chrome.storage.local.get('lastResponse');
    if (!lastResponse) return 'I do not have a previous response yet.';
    return lastResponse;
  }

  // ── Gmail ──────────────────────────────────────────────────────────────
  // Every email command auto-triggers sign-in on first use — no "connect gmail" step needed.

  // Helper: require an open email, returns id or a spoken error string
  async function requireOpenEmail() {
    const { gmailCurrentId } = await chrome.storage.local.get('gmailCurrentId');
    if (!gmailCurrentId) return { error: 'No email is open right now. Say "check my email" first, then "read email 1".' };
    return { id: gmailCurrentId };
  }

  // Helper: format an email list for speech
  function formatEmailList(emails, offset = 0) {
    return emails.map((e, i) => {
      const sender = extractName(e.from);
      const unread = e.isUnread ? ' (unread)' : '';
      return `${offset + i + 1}: From ${sender}, subject: ${e.subject}${unread}`;
    }).join('. ');
  }

  // Helper: save email list to storage for read/next commands
  async function storeEmailList(emails, query, offset) {
    await chrome.storage.local.set({
      gmailList: emails.map((e) => ({ id: e.id, from: e.from, subject: e.subject, snippet: e.snippet, isUnread: e.isUnread })),
      gmailListQuery: query,
      gmailListOffset: offset,
    });
  }

  // ── "Open Gmail" / "Go to Gmail" — opens gmail.com OR checks email ────
  if (
    (any(lower, 'open gmail', 'open my gmail', 'go to gmail', 'open my email', 'open email',
               'open my mail', 'go to my email', 'go to my mail', 'go to email',
               'take me to gmail', 'take me to email', 'take me to my email',
               'launch gmail', 'open inbox', 'open my inbox', 'go to inbox'))
  ) {
    try {
      const count = await getUnreadCount();
      if (count > 0) {
        const emails = await listUnread(5);
        await storeEmailList(emails, 'in:inbox is:unread', 0);
        const list = formatEmailList(emails);
        const more = count > 5 ? ` Say "more emails" to hear the next batch.` : '';
        return `You have ${count} unread email${count === 1 ? '' : 's'}. Here are the first ${emails.length}: ${list}. Say "read email" followed by the number.${more}`;
      }
      return 'Your inbox is clear — no unread emails. Say "show all email" to browse older messages.';
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not open Gmail: ${err.message}`;
    }
  }

  // ── Connect / Disconnect (still available but not required) ────────────
  if (any(lower, 'connect gmail', 'sign in to gmail', 'login to gmail', 'link gmail', 'connect my email', 'connect email', 'sign in to email', 'login to email')) {
    try {
      await getAuthToken(true);
      return 'Gmail connected. You can now say "check my email".';
    } catch (err) {
      return `Could not connect Gmail: ${err.message}. Make sure you are signed in to Chrome.`;
    }
  }

  if (any(lower, 'disconnect gmail', 'sign out of gmail', 'unlink gmail', 'disconnect email', 'sign out of email', 'remove gmail')) {
    try {
      const token = await getAuthToken(false);
      if (token) await removeCachedToken(token);
      return 'Gmail disconnected. A sign-in window will open automatically next time you use an email command.';
    } catch { return 'Gmail is already disconnected.'; }
  }

  if (any(lower, 'gmail status', 'is gmail connected', 'email status', 'is email connected')) {
    const connected = await isGmailConnected();
    return connected ? 'Gmail is connected and ready.' : 'Gmail is not connected yet. Just say "check my email" and sign-in will open automatically.';
  }

  // ── How many unread / total ───────────────────────────────────────────
  if (
    any(lower, 'how many unread', 'how many new email', 'how many emails', 'how many email',
               'how many mail', 'unread count', 'email count', 'count my email', 'count my mail',
               'do i have any email', 'do i have any mail', 'do i have new email', 'do i have new mail',
               'any unread', 'any new email', 'any new mail', 'any emails')
  ) {
    try {
      const count = await getUnreadCount();
      return count === 0
        ? 'You have no unread emails.'
        : `You have ${count} unread email${count === 1 ? '' : 's'}. Say "check my email" to hear them.`;
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not check: ${err.message}`;
    }
  }

  // ── Check inbox / read emails (paginated, 5 at a time) ───────────────
  if (
    any(lower, 'check my email', 'check email', 'check my mail', 'read my email', 'read my mail',
               'unread email', 'unread mail', 'new emails', 'new mail',
               'check inbox', 'read inbox', 'show inbox', 'show my email', 'show my mail',
               'what emails do i have', 'show all email', 'show all mail', 'list email', 'list my email',
               'list my mail', 'read all email', 'show emails', 'show mail', 'my emails', 'my mail',
               'what is in my inbox', "what's in my inbox", 'inbox')
  ) {
    try {
      const wantUnread = any(lower, 'unread', 'new');
      const query = wantUnread ? 'in:inbox is:unread' : 'in:inbox';
      const emails = wantUnread ? await listUnread(5) : await listMessages(5, query);
      if (!emails.length) return wantUnread ? 'You have no unread emails.' : 'Your inbox is empty.';

      await storeEmailList(emails, query, 0);
      const list = formatEmailList(emails);
      const more = emails.length >= 5 ? ' Say "more emails" to hear the next batch.' : '';
      return `${emails.length} email${emails.length === 1 ? '' : 's'}. ${list}. Say "read email" followed by the number.${more}`;
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not check email: ${err.message}`;
    }
  }

  // ── More emails / next emails / continue (pagination) ─────────────────
  if (
    any(lower, 'more email', 'more emails', 'more mail', 'next email', 'next emails', 'next mail',
               'continue reading email', 'continue email', 'show more email', 'show more emails',
               'show more mail', 'load more email', 'other email', 'other emails', 'remaining email',
               'keep reading email', 'next batch', 'read more email', 'read more emails') ||
    (any(lower, 'more', 'next', 'continue') && any(lower, 'email', 'mail', 'inbox', 'message'))
  ) {
    try {
      const { gmailListQuery = 'in:inbox', gmailListOffset = 0 } =
        await chrome.storage.local.get(['gmailListQuery', 'gmailListOffset']);
      const newOffset = gmailListOffset + 5;
      const emails = await listMessages(5, `${gmailListQuery}`);
      // Fetch a larger batch to get the next page
      const allEmails = await listMessages(newOffset + 5, gmailListQuery);
      const page = allEmails.slice(newOffset, newOffset + 5);

      if (!page.length) return 'No more emails to show. Say "check my email" to start over.';

      await storeEmailList(page, gmailListQuery, newOffset);
      const list = formatEmailList(page, newOffset);
      const more = page.length >= 5 ? ' Say "more emails" for the next batch.' : ' That is all.';
      return `${list}.${more}`;
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not load more emails: ${err.message}`;
    }
  }

  // ── Read specific email by number ─────────────────────────────────────
  {
    const emailWordNums = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const emailOrdinals = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
    let emailNum = null;

    // "read email 1", "open email 3", "show message 2", "email number 5"
    const emailDigitMatch = lower.match(/(?:read|open|show|get|check|view)\s+(?:the\s+)?(?:email|mail|message)\s+(?:number\s+)?(\d{1,2})/);
    if (emailDigitMatch) emailNum = parseInt(emailDigitMatch[1], 10);

    // "email 3", "mail 2" (bare)
    if (emailNum === null) {
      const bareEmailMatch = lower.match(/^(?:email|mail|message)\s+(\d{1,2})$/);
      if (bareEmailMatch) emailNum = parseInt(bareEmailMatch[1], 10);
    }

    // "read the first email", "open the second one"
    if (emailNum === null) {
      const ordMatch = lower.match(/(?:read|open|show|get|check|view)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s*(?:email|mail|message|one)?/);
      if (ordMatch) emailNum = emailOrdinals[ordMatch[1]];
    }

    // "read email one", "open mail two"
    if (emailNum === null) {
      const wordMatch = lower.match(/(?:read|open|show|get|check|view)\s+(?:the\s+)?(?:email|mail|message)\s+(?:number\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)/);
      if (wordMatch) emailNum = emailWordNums[wordMatch[1]];
    }

    if (emailNum !== null && emailNum >= 1) {
      try {
        const { gmailList = [], gmailListOffset = 0 } = await chrome.storage.local.get(['gmailList', 'gmailListOffset']);
        if (!gmailList.length) return 'No email list loaded. Say "check my email" first.';
        const localIdx = emailNum - gmailListOffset - 1;
        if (localIdx < 0 || localIdx >= gmailList.length) {
          return `I only have emails ${gmailListOffset + 1} through ${gmailListOffset + gmailList.length} loaded. Say a number in that range, or say "more emails" first.`;
        }

        const email = await getMessage(gmailList[localIdx].id);
        await markAsRead(email.id);
        await chrome.storage.local.set({ gmailCurrentId: email.id, gmailCurrentIdx: emailNum });

        const sender = extractName(email.from);
        const body = email.body.slice(0, 1500) || email.snippet;
        return `Email from ${sender}. Subject: ${email.subject}. Date: ${email.date}. ${body}. You can say: reply, next email, delete, archive, mark important, or star this email.`;
      } catch (err) {
        if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
        return `Could not read email: ${err.message}`;
      }
    }
  }

  // ── Read next / previous email in list ────────────────────────────────
  if (
    any(lower, 'next email', 'read next email', 'read next', 'next message', 'next mail',
               'show next email', 'open next email', 'read the next email', 'read the next one',
               'go to next email', 'skip email', 'skip this email', 'skip to next')
  ) {
    try {
      const { gmailList = [], gmailCurrentIdx = 0, gmailListOffset = 0 } =
        await chrome.storage.local.get(['gmailList', 'gmailCurrentIdx', 'gmailListOffset']);
      const nextNum = gmailCurrentIdx + 1;
      const localIdx = nextNum - gmailListOffset - 1;
      if (localIdx < 0 || localIdx >= gmailList.length) {
        return 'No more emails in the current list. Say "more emails" to load the next batch.';
      }
      const email = await getMessage(gmailList[localIdx].id);
      await markAsRead(email.id);
      await chrome.storage.local.set({ gmailCurrentId: email.id, gmailCurrentIdx: nextNum });
      const sender = extractName(email.from);
      const body = email.body.slice(0, 1500) || email.snippet;
      return `Email ${nextNum}. From ${sender}. Subject: ${email.subject}. ${body}. Say reply, next email, delete, archive, or mark important.`;
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not read next email: ${err.message}`;
    }
  }

  if (
    any(lower, 'previous email', 'read previous email', 'previous message', 'previous mail',
               'go back to email', 'last email', 'read last email', 'read the previous email',
               'read the previous one', 'back to email', 'go back email')
  ) {
    try {
      const { gmailList = [], gmailCurrentIdx = 0, gmailListOffset = 0 } =
        await chrome.storage.local.get(['gmailList', 'gmailCurrentIdx', 'gmailListOffset']);
      const prevNum = gmailCurrentIdx - 1;
      const localIdx = prevNum - gmailListOffset - 1;
      if (localIdx < 0 || prevNum < 1) return 'You are at the first email.';
      if (localIdx >= gmailList.length) return 'Email not in current list.';
      const email = await getMessage(gmailList[localIdx].id);
      await chrome.storage.local.set({ gmailCurrentId: email.id, gmailCurrentIdx: prevNum });
      const sender = extractName(email.from);
      const body = email.body.slice(0, 1500) || email.snippet;
      return `Email ${prevNum}. From ${sender}. Subject: ${email.subject}. ${body}. Say reply, next email, delete, archive, or mark important.`;
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not read previous email: ${err.message}`;
    }
  }

  // ── Go back to inbox / email list ─────────────────────────────────────
  if (
    any(lower, 'go back to inbox', 'back to inbox', 'go to inbox', 'show inbox again',
               'back to email', 'back to my email', 'email list', 'back to email list',
               'go back to email', 'go back to mail', 'back to mail')
  ) {
    try {
      const { gmailList = [], gmailListOffset = 0 } = await chrome.storage.local.get(['gmailList', 'gmailListOffset']);
      if (!gmailList.length) return 'No email list loaded. Say "check my email".';
      const list = formatEmailList(gmailList, gmailListOffset);
      await chrome.storage.local.remove(['gmailCurrentId', 'gmailCurrentIdx']);
      return `Back to your email list. ${list}. Say "read email" followed by the number.`;
    } catch (err) {
      return `Could not go back: ${err.message}`;
    }
  }

  // ── Reply (AI-composed) ────────────────────────────────────────────────
  {
    const replyMatch = lower.match(/(?:reply|respond|write back|answer|reply to (?:this |the )?(?:email|mail|message)?)\s*(?:saying\s+|with\s+|that\s+)?(.+)/);
    if (replyMatch) {
      const intent = replyMatch[1].trim();
      if (intent) {
        try {
          const cur = await requireOpenEmail();
          if (cur.error) return cur.error;

          const original = await getMessage(cur.id);
          const { userName = '' } = await chrome.storage.local.get('userName');

          const draft = await draftEmailWithAI({ intent, originalEmail: original, userName });
          const finalBody = draft?.body || intent;

          await replyToMessage(cur.id, finalBody);
          return `Reply sent. Here is what I wrote: ${finalBody}`;
        } catch (err) {
          return `Could not send reply: ${err.message}`;
        }
      }
    }
  }

  // ── Compose / Send (AI-composed) ────────────────────────────────────
  {
    const composeMatch = lower.match(/(?:send|compose|write|draft)\s+(?:an?\s+)?(?:email|mail|message)\s+to\s+([\w.+\-]+@[\w.\-]+)\s*(?:saying|about|with|subject|body|message)?\s*(.*)?/);
    if (composeMatch) {
      const to = composeMatch[1].trim();
      const intent = (composeMatch[2] || '').trim();
      if (to) {
        try {
          if (!intent) return `What would you like to say? Say: send email to ${to} saying your message.`;

          const { userName = '' } = await chrome.storage.local.get('userName');
          const draft = await draftEmailWithAI({ intent, recipientAddress: to, userName });

          const subject = draft?.subject || 'Message from Voice Assistant';
          const body = draft?.body || intent;

          await sendEmail({ to, subject, body });
          return `Email sent to ${to}. Here is what I wrote: ${body}`;
        } catch (err) {
          return `Could not send email: ${err.message}`;
        }
      }
    }
  }

  // ── Archive ───────────────────────────────────────────────────────────
  if (
    any(lower, 'archive email', 'archive this email', 'archive this', 'archive mail',
               'archive the email', 'archive this message', 'archive it', 'move to archive')
  ) {
    try {
      const cur = await requireOpenEmail();
      if (cur.error) return cur.error;
      await archiveMessage(cur.id);
      await chrome.storage.local.remove(['gmailCurrentId', 'gmailCurrentIdx']);
      return 'Email archived. Say "next email" to continue or "check my email" for a fresh list.';
    } catch (err) { return `Could not archive: ${err.message}`; }
  }

  // ── Delete / Trash ────────────────────────────────────────────────────
  if (
    any(lower, 'delete email', 'delete this email', 'trash email', 'trash this email',
               'delete this', 'delete mail', 'trash this', 'delete this message',
               'throw away email', 'throw away this email', 'remove email', 'remove this email',
               'trash it', 'delete it', 'get rid of this email')
  ) {
    try {
      const cur = await requireOpenEmail();
      if (cur.error) return cur.error;
      await trashMessage(cur.id);
      await chrome.storage.local.remove(['gmailCurrentId', 'gmailCurrentIdx']);
      return 'Email moved to trash. Say "next email" to continue.';
    } catch (err) { return `Could not delete: ${err.message}`; }
  }

  // ── Mark as important / not important ─────────────────────────────────
  if (
    any(lower, 'mark important', 'mark as important', 'mark email important', 'mark this important',
               'mark this email as important', 'important email', 'make important', 'set important',
               'flag this', 'flag email', 'flag this email', 'mark it important')
  ) {
    try {
      const cur = await requireOpenEmail();
      if (cur.error) return cur.error;
      await markImportant(cur.id);
      return 'Marked as important.';
    } catch (err) { return `Could not mark important: ${err.message}`; }
  }

  if (
    any(lower, 'remove important', 'unmark important', 'mark not important', 'mark as not important',
               'unflag', 'unflag email', 'unflag this', 'remove flag', 'mark it not important')
  ) {
    try {
      const cur = await requireOpenEmail();
      if (cur.error) return cur.error;
      await markNotImportant(cur.id);
      return 'Removed important label.';
    } catch (err) { return `Could not update: ${err.message}`; }
  }

  // ── Star / Unstar ─────────────────────────────────────────────────────
  if (
    any(lower, 'star email', 'star this email', 'star this', 'star it',
               'add star', 'mark star', 'star this message', 'save for later')
  ) {
    try {
      const cur = await requireOpenEmail();
      if (cur.error) return cur.error;
      await starMessage(cur.id);
      return 'Email starred.';
    } catch (err) { return `Could not star: ${err.message}`; }
  }

  if (
    any(lower, 'unstar email', 'unstar this', 'unstar it', 'remove star', 'unstar this email')
  ) {
    try {
      const cur = await requireOpenEmail();
      if (cur.error) return cur.error;
      await unstarMessage(cur.id);
      return 'Star removed.';
    } catch (err) { return `Could not unstar: ${err.message}`; }
  }

  // ── Mark read / unread ────────────────────────────────────────────────
  if (
    any(lower, 'mark as read', 'mark read', 'mark email read', 'mark this read', 'mark it read',
               'mark this email as read')
  ) {
    try {
      const cur = await requireOpenEmail();
      if (cur.error) return cur.error;
      await markAsRead(cur.id);
      return 'Marked as read.';
    } catch (err) { return `Could not mark read: ${err.message}`; }
  }

  if (
    any(lower, 'mark as unread', 'mark unread', 'mark email unread', 'mark this unread', 'mark it unread',
               'mark this email as unread', 'keep as unread', 'keep unread')
  ) {
    try {
      const cur = await requireOpenEmail();
      if (cur.error) return cur.error;
      await markAsUnread(cur.id);
      return 'Marked as unread.';
    } catch (err) { return `Could not mark unread: ${err.message}`; }
  }

  // ── Show starred / important / sent emails ────────────────────────────
  if (any(lower, 'starred email', 'show starred', 'my starred', 'starred mail', 'show my starred', 'read starred')) {
    try {
      const emails = await listMessages(5, 'is:starred');
      if (!emails.length) return 'You have no starred emails.';
      await storeEmailList(emails, 'is:starred', 0);
      return `${emails.length} starred email${emails.length === 1 ? '' : 's'}. ${formatEmailList(emails)}. Say "read email" followed by the number.`;
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not load starred: ${err.message}`;
    }
  }

  if (any(lower, 'important email', 'show important', 'my important', 'important mail', 'show my important', 'read important')) {
    try {
      const emails = await listMessages(5, 'is:important');
      if (!emails.length) return 'You have no important emails.';
      await storeEmailList(emails, 'is:important', 0);
      return `${emails.length} important email${emails.length === 1 ? '' : 's'}. ${formatEmailList(emails)}. Say "read email" followed by the number.`;
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not load important: ${err.message}`;
    }
  }

  if (any(lower, 'sent email', 'show sent', 'my sent', 'sent mail', 'show my sent', 'read sent', 'sent messages')) {
    try {
      const emails = await listMessages(5, 'in:sent');
      if (!emails.length) return 'You have no sent emails.';
      await storeEmailList(emails, 'in:sent', 0);
      return `${emails.length} sent email${emails.length === 1 ? '' : 's'}. ${formatEmailList(emails)}. Say "read email" followed by the number.`;
    } catch (err) {
      if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
      return `Could not load sent: ${err.message}`;
    }
  }

  // ── Search email ──────────────────────────────────────────────────────
  {
    const emailSearchMatch = lower.match(/(?:search|find|look for)\s+(?:my\s+)?(?:email|mail|inbox|gmail|messages?)\s+(?:for\s+|about\s+|from\s+|with\s+)?(.+)/);
    if (emailSearchMatch) {
      const query = emailSearchMatch[1].trim();
      if (query) {
        try {
          const emails = await listMessages(5, query);
          if (!emails.length) return `No emails found for "${query}".`;
          await storeEmailList(emails, query, 0);
          const list = formatEmailList(emails);
          return `Found ${emails.length} email${emails.length === 1 ? '' : 's'} matching "${query}". ${list}. Say "read email" followed by the number.`;
        } catch (err) {
          if (isGmailAuthError(err)) return GMAIL_SIGNIN_MSG;
          return `Could not search: ${err.message}`;
        }
      }
    }
  }

  // ── "Who sent this" / "Who is this from" — about the open email ─────
  if (
    any(lower, 'who sent this', 'who is this from', 'who sent this email', 'who is the sender',
               'who emailed me', 'who wrote this', 'sender')
  ) {
    const cur = await requireOpenEmail();
    if (cur.error) return cur.error;
    try {
      const email = await getMessage(cur.id);
      return `This email is from ${email.from}. Subject: ${email.subject}.`;
    } catch (err) { return `Could not get sender: ${err.message}`; }
  }

  // ── Page interaction: type / search / click ────────────────────────────

  // "type hello" / "type Google into the search bar"
  const typeMatch = lower.match(/(?:type|write|input)\s+(.+?)(?:\s+(?:in|into|on|in the|into the)\s+.+)?$/);
  if (typeMatch && !any(lower, 'content', 'contenteditable')) {
    const text = typeMatch[1].replace(/\s+(?:in|into|on)\s+.*$/, '').trim();
    if (text) {
      // If on a known site, use URL search directly — much more reliable
      const url = await getActiveTabUrl();
      const site = siteFromUrl(url);
      if (SITE_SEARCH_URLS[site]) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: SITE_SEARCH_URLS[site](text) });
        return `Searching for "${text}" on ${site}.`;
      }
      const res = await sendToContent({ type: 'TYPE_INTO_INPUT', text });
      if (res?.ok) return `Typed "${text}" into ${res.target || 'the input field'}.`;
      if (res?.error === 'no-input') return 'I could not find an input field on this page. Try saying "focus search" first.';
      return res?.message || 'Could not type on this page.';
    }
  }

  // "search for cats" / "search Iran" / "search for cooking videos"
  const searchMatch = lower.match(/search\s+(?:for\s+)?(.+?)(?:\s+on this page)?$/);
  if (searchMatch && !any(lower, 'how many', 'tab', 'find tab', 'search bar', 'focus search')) {
    const query = searchMatch[1].trim();
    if (query && query.length > 1) {
      // Check if we're on a known site — use URL search
      const url = await getActiveTabUrl();
      const site = siteFromUrl(url);
      if (SITE_SEARCH_URLS[site]) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: SITE_SEARCH_URLS[site](query) });
        return `Searching for "${query}" on ${site}.`;
      }
      // Not on a known site — try Google search
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: SITE_SEARCH_URLS['google.com'](query) });
      return `Searching Google for "${query}".`;
    }
  }

  // "search YouTube for cats" / "search Google for weather"
  const searchSiteMatch = lower.match(/search\s+(youtube|google|bing|reddit|amazon|wikipedia|github|twitter|ebay|netflix|spotify)\s+(?:for\s+)?(.+)/);
  if (searchSiteMatch) {
    const siteName = searchSiteMatch[1].trim();
    const query = searchSiteMatch[2].trim();
    const siteKey = Object.keys(SITE_SEARCH_URLS).find((k) => k.startsWith(siteName));
    if (siteKey && query) {
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: SITE_SEARCH_URLS[siteKey](query) });
      return `Searching ${siteName} for "${query}".`;
    }
  }

  // ── List / play media items (paginated, 5 at a time) ─────────────────────
  if (
    any(lower, 'list videos', 'show videos', 'what videos', 'read videos',
               'list the videos', 'show the videos', 'read the videos', 'show me the videos',
               'list results', 'show results', 'what results', 'read results',
               'list the results', 'show the results', 'read the results', 'show me the results',
               'what can i watch', 'what can i play', 'what videos are here',
               'list the titles', 'read the titles', 'show me what') ||
    (has(lower, 'list') && any(lower, 'video', 'result', 'title')) ||
    (has(lower, 'show') && any(lower, 'video', 'result', 'title')) ||
    (has(lower, 'read') && any(lower, 'video', 'result', 'title'))
  ) {
    const res = await sendToContent({ type: 'LIST_MEDIA' });
    if (res?.ok && res.items?.length) {
      const page = res.items.slice(0, 5);
      await chrome.storage.local.set({ mediaListOffset: 5, mediaListTotal: res.items.length });
      const speech = formatMediaPage(page, 0);
      const more = res.items.length > 5 ? ` Say "next" to hear more.` : '';
      return `Found ${res.items.length} items. ${speech}.${more} Say "play" followed by the number to play one.`;
    }

    // Fallback: read page title so user at least knows where they are
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageTitle = tab?.title || 'this page';
    return `I could not detect any video items on ${pageTitle}. The page may still be loading. Try saying "list videos" again in a moment.`;
  }

  // "next" / "next videos" / "more videos" / "show more" — paginate
  if (any(lower, 'next', 'more', 'next videos', 'more videos', 'show more', 'next results', 'more results')) {
    const { mediaListOffset = 0, mediaListTotal = 0 } = await chrome.storage.local.get(['mediaListOffset', 'mediaListTotal']);
    if (mediaListOffset > 0 && mediaListOffset < mediaListTotal) {
      const res = await sendToContent({ type: 'LIST_MEDIA' });
      if (res?.ok && res.items?.length) {
        const page = res.items.slice(mediaListOffset, mediaListOffset + 5);
        if (!page.length) return 'No more items to show.';
        const newOffset = mediaListOffset + 5;
        await chrome.storage.local.set({ mediaListOffset: newOffset });
        const speech = formatMediaPage(page, mediaListOffset);
        const more = newOffset < res.items.length ? ` Say "next" for more.` : ' That is all.';
        return `${speech}.${more}`;
      }
    }
    return null; // not in a media listing context — let other handlers try
  }

  // "play number 1" / "play item one" / "play the first video" / "open number 2"
  {
    const ordinals = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
                       eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };
    const wordNums = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
                       eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
    let videoNum = null;

    // Match digit: "play 1", "play number 3", "play video 5", "play item 2", "play result 4"
    const numMatch = lower.match(/(?:play|open|select|click|watch|go to)\s+(?:the\s+)?(?:video\s+|number\s+|result\s+|item\s+|#)?(\d{1,2})/);
    if (numMatch) videoNum = parseInt(numMatch[1], 10);

    // Match word number: "play item one", "play number two", "play video three"
    if (videoNum === null) {
      const wordMatch = lower.match(/(?:play|open|select|click|watch|go to)\s+(?:the\s+)?(?:video\s+|number\s+|result\s+|item\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/);
      if (wordMatch) videoNum = wordNums[wordMatch[1]];
    }

    // Match ordinal: "play the first video", "play first", "play the second one"
    if (videoNum === null) {
      const ordMatch = lower.match(/(?:play|open|select|click|watch|go to)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\s*(?:video|result|item|one)?/);
      if (ordMatch) videoNum = ordinals[ordMatch[1]];
    }

    // Last resort: "item one", "item 3", "number two" — any mention of item/number + value
    if (videoNum === null) {
      const itemMatch = lower.match(/(?:item|number)\s+(\d{1,2})/);
      if (itemMatch) videoNum = parseInt(itemMatch[1], 10);
    }
    if (videoNum === null) {
      const itemWordMatch = lower.match(/(?:item|number)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/);
      if (itemWordMatch) videoNum = wordNums[itemWordMatch[1]];
    }

    if (videoNum !== null && videoNum >= 1) {
      const res = await sendToContent({ type: 'CLICK_MEDIA_N', index: videoNum - 1 });
      if (res?.ok) {
        if (res.url) {
          // Navigate via background — most reliable across all sites
          chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: res.url });
        }
        return `Playing: ${res.title}.`;
      }
      return res?.error || `Could not play video ${videoNum}.`;
    }
  }

  // ── YouTube-specific commands ─────────────────────────────────────────────
  {
    const url = await getActiveTabUrl();
    const site = siteFromUrl(url);

    if (site === 'youtube.com') {
      // YouTube controls using HTML5 video API (reliable) + keyboard sim for UI-only features
      // Reference: https://support.google.com/youtube/answer/7631406

      // ── Seek to beginning — MUST be before play/pause check ──────────────
      if (any(lower, 'from beginning', 'from the beginning', 'from the start', 'from start',
                     'beginning', 'start over', 'restart video', 'restart the video') ||
          (has(lower, 'start') && any(lower, 'beginning', 'start', 'over')) ||
          (has(lower, 'play') && any(lower, 'beginning', 'start'))) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'seek_start' });
        if (res?.error) return res.error;
        return 'Starting the video from the beginning.';
      }

      // ── Play / Pause — flexible matching ─────────────────────────────────
      if (any(lower, 'pause', 'pause video', 'pause the video', 'stop video', 'stop the video')) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'pause' });
        if (res?.error) return res.error;
        return 'Paused.';
      }
      if (any(lower, 'play', 'start', 'resume', 'continue',
                     'play video', 'play the video', 'start video', 'start the video',
                     'resume video', 'resume the video', 'unpause',
                     'can you play', 'can you start', 'start it', 'play it') ||
          (has(lower, 'video') && any(lower, 'play', 'start', 'resume'))) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'play' });
        if (res?.error) return res.error;
        return 'Playing.';
      }

      // ── Mute / Unmute ────────────────────────────────────────────────────
      if (any(lower, 'mute', 'unmute', 'toggle mute', 'mute video', 'unmute video')) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'mute' });
        return res?.muted ? 'Muted.' : 'Unmuted.';
      }

      // ── Volume ───────────────────────────────────────────────────────────
      if (any(lower, 'volume up', 'louder', 'turn up volume', 'increase volume', 'raise volume')) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'volume', delta: 0.1 });
        return `Volume: ${res?.volume ?? ''}%.`;
      }
      if (any(lower, 'volume down', 'quieter', 'turn down volume', 'decrease volume', 'lower volume')) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'volume', delta: -0.1 });
        return `Volume: ${res?.volume ?? ''}%.`;
      }

      // ── Speed ────────────────────────────────────────────────────────────
      if (any(lower, 'speed up video', 'faster video', 'increase speed', 'playback faster')) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'speed', delta: 0.25 });
        return `Playback speed: ${res?.speed ?? ''}x.`;
      }
      if (any(lower, 'slow down video', 'slower video', 'decrease speed', 'playback slower')) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'speed', delta: -0.25 });
        return `Playback speed: ${res?.speed ?? ''}x.`;
      }

      // ── Seek: rewind / forward ───────────────────────────────────────────
      if (any(lower, 'rewind', 'go back 10', 'skip back 10', 'back 10 seconds', 'rewind 10')) {
        await sendToContent({ type: 'YT_CONTROL', action: 'seek', delta: -10 });
        return 'Rewinding 10 seconds.';
      }
      if (any(lower, 'fast forward', 'forward 10', 'skip forward 10', 'skip ahead 10', 'forward 10 seconds')) {
        await sendToContent({ type: 'YT_CONTROL', action: 'seek', delta: 10 });
        return 'Skipping forward 10 seconds.';
      }
      if (any(lower, 'skip back', 'back 5 seconds', 'back 5', 'rewind 5', 'go back 5')) {
        await sendToContent({ type: 'YT_CONTROL', action: 'seek', delta: -5 });
        return 'Rewinding 5 seconds.';
      }
      if (any(lower, 'skip ahead', 'forward 5 seconds', 'forward 5', 'ahead 5', 'skip forward')) {
        await sendToContent({ type: 'YT_CONTROL', action: 'seek', delta: 5 });
        return 'Skipping forward 5 seconds.';
      }

      // ── Seek to percentage ───────────────────────────────────────────────
      {
        const pctMatch = lower.match(/(?:jump to|go to|skip to|seek to)\s+(\d{1,3})\s*%/);
        if (pctMatch) {
          const pct = parseInt(pctMatch[1], 10);
          if (pct >= 0 && pct <= 100) {
            await sendToContent({ type: 'YT_CONTROL', action: 'seek_pct', percent: pct });
            return `Jumping to ${pct}% of the video.`;
          }
        }
        if (any(lower, 'go to halfway', 'jump to middle', 'skip to middle', 'halfway', 'middle of video')) {
          await sendToContent({ type: 'YT_CONTROL', action: 'seek_pct', percent: 50 });
          return 'Jumping to 50% of the video.';
        }
      }

      // ── Video status ─────────────────────────────────────────────────────
      if (any(lower, 'video status', 'how long is this video', 'how far', 'what time in the video', 'where am i in the video')) {
        const res = await sendToContent({ type: 'YT_CONTROL', action: 'status' });
        if (res?.ok) {
          const mins = Math.floor(res.time / 60);
          const secs = res.time % 60;
          const durMins = Math.floor(res.duration / 60);
          const durSecs = res.duration % 60;
          return `You are at ${mins} minutes ${secs} seconds out of ${durMins} minutes ${durSecs} seconds. Volume: ${res.volume}%. Speed: ${res.speed}x. ${res.paused ? 'Paused.' : 'Playing.'}`;
        }
        return 'Could not get video status.';
      }

      // ── Next / Previous video (Shift+N / Shift+P) ───────────────────────
      if (any(lower, 'next video', 'skip video', 'skip this')) {
        await sendToContent({ type: 'SIMULATE_KEY', key: 'N', shift: true });
        return 'Skipping to next video.';
      }
      if (any(lower, 'previous video', 'last video', 'go back video')) {
        await sendToContent({ type: 'SIMULATE_KEY', key: 'P', shift: true });
        return 'Going to previous video.';
      }

      // ── UI controls (keyboard sim — no video API for these) ──────────────
      if (any(lower, 'fullscreen', 'full screen', 'enter fullscreen', 'exit fullscreen')) {
        await sendToContent({ type: 'SIMULATE_KEY', key: 'f' });
        return 'Toggling fullscreen.';
      }
      if (any(lower, 'captions', 'subtitles', 'turn on captions', 'turn off captions', 'toggle captions', 'toggle subtitles')) {
        await sendToContent({ type: 'SIMULATE_KEY', key: 'c' });
        return 'Toggling captions.';
      }
      if (any(lower, 'miniplayer', 'mini player', 'picture in picture', 'pip mode', 'small player')) {
        await sendToContent({ type: 'SIMULATE_KEY', key: 'i' });
        return 'Toggling miniplayer.';
      }
      if (any(lower, 'youtube search', 'focus youtube search', 'go to youtube search')) {
        await sendToContent({ type: 'SIMULATE_KEY', key: '/' });
        return 'Focused on YouTube search box.';
      }

      // YouTube URL navigation
      if (any(lower, 'trending', 'show trending', 'youtube trending', 'what is trending')) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: 'https://www.youtube.com/feed/trending' });
        return 'Opening YouTube Trending.';
      }
      if (any(lower, 'subscriptions', 'my subscriptions', 'show subscriptions', 'youtube subscriptions')) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: 'https://www.youtube.com/feed/subscriptions' });
        return 'Opening your Subscriptions.';
      }
      if (any(lower, 'watch history', 'my history', 'youtube history', 'show history', 'viewing history')) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: 'https://www.youtube.com/feed/history' });
        return 'Opening your Watch History.';
      }
      if (any(lower, 'liked videos', 'my liked', 'show liked', 'videos i liked')) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: 'https://www.youtube.com/playlist?list=LL' });
        return 'Opening your Liked Videos.';
      }
      if (any(lower, 'watch later', 'my watch later', 'show watch later')) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: 'https://www.youtube.com/playlist?list=WL' });
        return 'Opening Watch Later.';
      }
      if (any(lower, 'shorts', 'youtube shorts', 'show shorts')) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: 'https://www.youtube.com/shorts' });
        return 'Opening YouTube Shorts.';
      }
      if (any(lower, 'youtube home', 'go home', 'home page', 'youtube main')) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: 'https://www.youtube.com/' });
        return 'Going to YouTube Home.';
      }
    }
  }

  // "click Sign in" / "click the subscribe button"
  const clickMatch = lower.match(/(?:click|tap)\s+(?:the\s+)?(?:on\s+)?(.+?)(?:\s+button)?$/);
  if (clickMatch && !any(lower, 'enter', 'tab', 'escape', 'reading', 'speaking')) {
    const target = clickMatch[1].trim();
    if (target && target.length > 1) {
      const res = await sendToContent({ type: 'CLICK_BY_TEXT', text: target });
      if (res?.ok) return `Clicked "${res.clicked}".`;
      return res?.error || `Could not find "${target}" on this page.`;
    }
  }

  // "press enter" / "submit"
  if (any(lower, 'press enter', 'hit enter', 'submit', 'submit form')) {
    const res = await sendToContent({ type: 'PRESS_ENTER' });
    if (res?.ok) return 'Pressed enter.';
    return res?.error || 'Could not press enter.';
  }

  // "focus search" / "go to search bar"
  if (any(lower, 'focus search', 'go to search', 'search bar', 'find search', 'focus input', 'go to input')) {
    const res = await sendToContent({ type: 'FOCUS_SEARCH' });
    if (res?.ok) return `Focused on ${res.target || 'the search field'}.`;
    return 'Could not find a search field on this page.';
  }

  // "clear input" / "clear the search"
  if (any(lower, 'clear input', 'clear the input', 'clear search', 'clear the search', 'clear the text', 'erase input')) {
    const res = await sendToContent({ type: 'CLEAR_INPUT' });
    if (res?.ok) return 'Cleared the input field.';
    return res?.error || 'Could not clear the input.';
  }

  // "what fields are on this page" / "show form fields"
  if (any(lower, 'form fields', 'what fields', 'show fields', 'list fields', 'input fields', 'what inputs')) {
    const res = await sendToContent({ type: 'GET_FORM_FIELDS' });
    if (res?.ok && res.fields?.length) {
      const list = res.fields.map((f, i) => `${i + 1}: ${f.label} (${f.type || f.tag})`).join('. ');
      return `Found ${res.fields.length} fields. ${list}.`;
    }
    return 'No form fields found on this page.';
  }

  // ── Identity — always answer this, regardless of AI ──────────────────────
  if (
    any(lower, 'who are you', 'what are you', 'what is your name', "what's your name",
                'who made you', 'who created you', 'who built you', 'are you gemini',
                'are you google', 'are you chatgpt', 'are you an ai', 'are you a robot',
                'introduce yourself', 'tell me about yourself')
  ) {
    return 'I am your Voice Assistant, built into Chrome to help you with anything on the web. Just tell me what you need.';
  }

  // ── Time ──────────────────────────────────────────────────────────────────
  if (
    any(lower, 'what time', 'current time', 'the time', "what's the time", 'tell me the time')
  ) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `The current time is ${timeStr}.`;
  }

  // ── Date / day ────────────────────────────────────────────────────────────
  if (
    any(lower, 'what date', 'what day', 'what is today', "what's today", 'current date', 'the date', 'today\'s date') ||
    (has(lower, 'today') && any(lower, 'what', 'which'))
  ) {
    const dateStr = new Date().toLocaleDateString([], {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    return `Today is ${dateStr}.`;
  }

  return null;
}

// ─── Layer 2: Page / navigation actions ──────────────────────────────────────

function tryPageAction(lower) {

  // ── Read page ──────────────────────────────────────────────────────────────
  if (
    any(lower, 'read this page', 'read the page', 'read page', 'read aloud', 'read out loud') ||
    any(lower, 'what is on this page', "what's on this page", 'what is on the page', 'read content') ||
    (has(lower, 'read') && any(lower, 'page', 'content', 'text', 'article'))
  ) {
    send('READ_PAGE');
    return 'Reading the page for you.';
  }

  // ── Summarise ─────────────────────────────────────────────────────────────
  if (any(lower, 'summarize', 'summarise', 'summary', 'give me a summary', 'brief summary', 'short summary', 'overview')) {
    send('SUMMARIZE');
    return 'Summarising this page for you.';
  }

  // ── List links ────────────────────────────────────────────────────────────
  if (
    any(lower, 'list links', 'show links', 'what links', 'what are the links', 'links on this page', 'read the links') ||
    (has(lower, 'links') && any(lower, 'list', 'show', 'read', 'tell', 'what'))
  ) {
    send('GET_LINKS');
    return 'Getting the links on this page.';
  }

  // ── Page title ────────────────────────────────────────────────────────────
  if (
    any(lower, 'page title', 'what is the title', "what's the title", 'title of this page', 'title of the page')
  ) {
    send('GET_TITLE');
    return 'Getting the page title.';
  }

  // ── Scroll down ───────────────────────────────────────────────────────────
  if (
    any(lower, 'scroll down', 'move down', 'go down', 'page down') ||
    (has(lower, 'scroll') && has(lower, 'down'))
  ) {
    send('SCROLL', { direction: 'down' });
    return 'Scrolling down.';
  }

  // ── Scroll up ─────────────────────────────────────────────────────────────
  if (
    any(lower, 'scroll up', 'move up', 'go up', 'page up') ||
    (has(lower, 'scroll') && has(lower, 'up'))
  ) {
    send('SCROLL', { direction: 'up' });
    return 'Scrolling up.';
  }

  // ── Go back ───────────────────────────────────────────────────────────────
  if (
    any(lower, 'go back', 'go backward', 'previous page', 'back page', 'navigate back') ||
    (has(lower, 'back') && any(lower, 'go', 'navigate', 'take me'))
  ) {
    send('GO_BACK');
    return 'Going back.';
  }

  // ── Go forward ────────────────────────────────────────────────────────────
  if (
    any(lower, 'go forward', 'next page', 'forward page', 'navigate forward') ||
    (has(lower, 'forward') && any(lower, 'go', 'navigate', 'take me'))
  ) {
    send('GO_FORWARD');
    return 'Going forward.';
  }

  // ── Reload ────────────────────────────────────────────────────────────────
  if (any(lower, 'reload', 'refresh', 'reload page', 'refresh page', 'reload this', 'refresh this')) {
    send('RELOAD');
    return 'Reloading the page.';
  }

  // ── Accessibility visual helpers ───────────────────────────────────────────
  if (any(lower, 'toggle high contrast', 'high contrast mode', 'enable high contrast', 'disable high contrast')) {
    send('TOGGLE_HIGH_CONTRAST');
    return 'Toggling high contrast mode.';
  }

  if (any(lower, 'increase text size', 'larger text', 'bigger text', 'zoom text in')) {
    send('INCREASE_TEXT_SIZE');
    return 'Increasing text size.';
  }

  if (any(lower, 'show focus highlight', 'toggle focus highlight', 'highlight focus')) {
    send('TOGGLE_FOCUS_HIGHLIGHT');
    return 'Toggling focus highlight.';
  }

  return null;
}

// ─── Layer 3: Chrome Built-in AI (Gemini Nano, on-device) ────────────────────
// Requires ~22 GB free disk + 4 GB VRAM (or 16 GB RAM on Chrome 140+).
// When available this is preferred: fully private, no API key needed.

async function isBuiltInAIAvailable() {
  try {
    if (!window.ai?.languageModel) return false;
    const { available } = await window.ai.languageModel.capabilities();
    return available !== 'no';
  } catch {
    return false;
  }
}

async function runBuiltInAIPrompt(text) {
  if (!aiSession) {
    aiSession = await window.ai.languageModel.create({
      systemPrompt:
        'You are a voice assistant built into a Chrome extension called Voice Assistant, designed to help blind and visually impaired users. ' +
        'Your job is to assist with any task in Chrome and on the web. ' +
        'Never say you are made by Google, never mention Gemini, never say you are a large language model. ' +
        'If asked who you are, say: I am your Voice Assistant, here to help you with anything in Chrome. ' +
        'Respond in plain spoken language only — no markdown, no bullet points, no symbols, no emojis. ' +
        'Keep answers under three sentences unless asked to read content aloud.',
    });
  }
  return aiSession.prompt(text);
}

export async function destroyAISession() {
  if (aiSession) {
    aiSession.destroy();
    aiSession = null;
  }
}

/**
 * Returns which AI layer is currently active.
 * Used by the settings UI to show a status indicator.
 * @returns {Promise<'built-in' | 'gemini-api' | 'none'>}
 */
export async function getActiveAIMode() {
  if (await isBuiltInAIAvailable()) return 'built-in';
  const key = await getApiKey();
  if (key) return 'gemini-api';
  return 'none';
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function send(type, extra = {}) {
  chrome.runtime.sendMessage({
    type: 'SEND_TO_CONTENT',
    payload: { type, ...extra },
  });
}
