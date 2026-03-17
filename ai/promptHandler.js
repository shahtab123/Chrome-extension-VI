// ai/promptHandler.js
// Command routing — three layers, in priority order:
//
//   1. Chrome API queries  — direct answers using chrome.tabs, chrome.storage, etc.
//                            No AI needed. Instant response.
//   2. Page actions        — tell the content script to do something (scroll, read, etc.)
//   3. AI (Gemini Nano)    — only for open-ended questions / summarisation
//
// Chrome Prompt API docs: https://developer.chrome.com/docs/extensions/ai/prompt-api

let aiSession = null;

/**
 * Main entry point called by sidepanel.js on every final transcript.
 * @param {string} text — raw transcribed speech
 * @returns {Promise<string>} spoken response
 */
export async function handleCommand(text) {
  const lower = text.toLowerCase().trim();

  // Layer 1 — Chrome API queries (no AI required)
  const apiResponse = await tryChromAPIQuery(lower);
  if (apiResponse !== null) return apiResponse;

  // Layer 2 — Page / navigation actions
  const actionResponse = tryPageAction(lower);
  if (actionResponse !== null) return actionResponse;

  // Layer 3 — AI (Gemini Nano) for everything else
  if (await isAIAvailable()) return runAIPrompt(text);

  return `I heard: "${text}". I don't know how to handle that yet.`;
}

// ─── Layer 1: Chrome API queries ─────────────────────────────────────────────
// These answer questions using chrome.* APIs directly — no AI, no page access.

async function tryChromAPIQuery(lower) {

  // ── Tabs ──────────────────────────────────────────────────────────────────
  if (/how many tabs/.test(lower) || /number of tabs/.test(lower) || /tab count/.test(lower)) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return `You have ${tabs.length} tab${tabs.length === 1 ? '' : 's'} open.`;
  }

  if (/list (my |all |open )?tabs/.test(lower) || /what tabs (are |do i have )?open/.test(lower)) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const names = tabs.map((t, i) => `${i + 1}: ${t.title || t.url}`).join('. ');
    return `You have ${tabs.length} tabs open. ${names}.`;
  }

  if (/what('s| is) (the )?(current |this )?tab/.test(lower) || /what page am i on/.test(lower) || /what site is this/.test(lower)) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? `You are on: ${tab.title}. URL: ${tab.url}.` : 'Could not get the current tab.';
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  if (/go to (.+)/.test(lower) || /open (.+\.com|.+\.org|.+\.net|.+\.io)/.test(lower)) {
    const match = lower.match(/(?:go to|open)\s+(.+)/) ;
    if (match) {
      let url = match[1].trim();
      if (!url.startsWith('http')) url = `https://${url}`;
      chrome.runtime.sendMessage({ type: 'OPEN_TAB', url });
      return `Opening ${url}.`;
    }
  }

  if (/open new tab/.test(lower) || /new tab/.test(lower)) {
    chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: 'chrome://newtab/' });
    return 'Opening a new tab.';
  }

  if (/close (this |current )?tab/.test(lower)) {
    chrome.runtime.sendMessage({ type: 'SEND_TO_CONTENT', payload: { type: 'CLOSE_TAB' } });
    return 'Closing this tab.';
  }

  // ── Storage / settings ────────────────────────────────────────────────────
  if (/what('s| is) my name/.test(lower) || /do you know my name/.test(lower)) {
    const { userName } = await chrome.storage.local.get('userName');
    return userName
      ? `Your name is ${userName}.`
      : "I don't know your name yet. You can say: remember my name is [name].";
  }

  if (/remember my name is (.+)/.test(lower)) {
    const match = lower.match(/remember my name is (.+)/);
    const name = capitalise(match[1].trim());
    await chrome.storage.local.set({ userName: name });
    return `Got it! I'll remember your name is ${name}.`;
  }

  if (/forget (my name|everything|all)/.test(lower)) {
    await chrome.storage.local.clear();
    return 'Done. I have cleared everything I remembered.';
  }

  // ── Time & date ───────────────────────────────────────────────────────────
  if (/what (time|day|date) is it/.test(lower) || /what('s| is) (today|the time|the date)/.test(lower)) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (/time/.test(lower)) return `The current time is ${timeStr}.`;
    if (/date|day|today/.test(lower)) return `Today is ${dateStr}.`;
    return `It is ${timeStr} on ${dateStr}.`;
  }

  return null; // not handled here — pass to next layer
}

// ─── Layer 2: Page / navigation actions ──────────────────────────────────────
// Commands that tell the content script to do something on the active page.

function tryPageAction(lower) {
  const PAGE_COMMANDS = [
    {
      patterns: [/read\s+(this\s+)?page/, /read\s+aloud/, /what.s on (this|the) page/, /read (the )?content/],
      action: 'READ_PAGE',
      reply:  'Reading the page for you.',
    },
    {
      patterns: [/scroll\s+down/],
      action: 'SCROLL',
      extra:  { direction: 'down' },
      reply:  'Scrolling down.',
    },
    {
      patterns: [/scroll\s+up/],
      action: 'SCROLL',
      extra:  { direction: 'up' },
      reply:  'Scrolling up.',
    },
    {
      patterns: [/go\s+back/, /previous\s+page/],
      action: 'GO_BACK',
      reply:  'Going back.',
    },
    {
      patterns: [/go\s+forward/, /next\s+page/],
      action: 'GO_FORWARD',
      reply:  'Going forward.',
    },
    {
      patterns: [/refresh|reload (this )?page/],
      action: 'RELOAD',
      reply:  'Reloading the page.',
    },
    {
      patterns: [/what (are the |are )?links/, /list (the )?links/],
      action: 'GET_LINKS',
      reply:  'Getting the links on this page.',
    },
    {
      patterns: [/summarize|give me a summary|summarise/],
      action: 'SUMMARIZE',
      reply:  'Summarising this page.',
    },
    {
      patterns: [/what('s| is) (the )?title/, /page title/],
      action: 'GET_TITLE',
      reply:  'Getting the page title.',
    },
  ];

  for (const cmd of PAGE_COMMANDS) {
    const matched = cmd.patterns.some((p) =>
      p instanceof RegExp ? p.test(lower) : lower.includes(p)
    );
    if (matched) {
      chrome.runtime.sendMessage({
        type:    'SEND_TO_CONTENT',
        payload: { type: cmd.action, ...(cmd.extra ?? {}) },
      });
      return cmd.reply;
    }
  }

  return null; // not handled here
}

// ─── Layer 3: Chrome Prompt API (Gemini Nano) ─────────────────────────────────

async function isAIAvailable() {
  try {
    if (!window.ai?.languageModel) return false;
    const { available } = await window.ai.languageModel.capabilities();
    return available !== 'no';
  } catch {
    return false;
  }
}

async function runAIPrompt(text) {
  if (!aiSession) {
    aiSession = await window.ai.languageModel.create({
      systemPrompt:
        'You are a helpful, concise voice assistant for blind and visually impaired users. ' +
        'Respond in plain spoken language — no markdown, no bullet points, no symbols. ' +
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
