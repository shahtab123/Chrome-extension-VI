// ai/memory.js
// Local conversation memory layer.
//
// Storage schema:
//   sessionHistory:  [{ question, response, at }]   — last 100 turns
//   userProfile:     [{ fact, learnedAt }]           — extracted facts/preferences
//   lastResponse:    string
//   lastQuestion:    string
//
// On each call to Gemini, we build a context block from:
//   • User profile facts
//   • Recent conversation turns
// This gives the AI continuity without any external service.

const MAX_HISTORY   = 100;
const MAX_PROFILE   = 50;
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getSessionHistory() {
  const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
  return sessionHistory;
}

export async function getUserProfile() {
  const { userProfile = [] } = await chrome.storage.local.get('userProfile');
  return userProfile;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function saveTurn(question, response) {
  const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
  sessionHistory.push({ question, response, at: Date.now() });
  await chrome.storage.local.set({
    lastQuestion: question,
    lastResponse: response,
    sessionHistory: sessionHistory.slice(-MAX_HISTORY),
  });
}

export async function addProfileFact(fact) {
  const { userProfile = [] } = await chrome.storage.local.get('userProfile');
  // Avoid exact duplicates
  if (userProfile.some((p) => p.fact.toLowerCase() === fact.toLowerCase())) return;
  userProfile.push({ fact, learnedAt: Date.now() });
  await chrome.storage.local.set({ userProfile: userProfile.slice(-MAX_PROFILE) });
}

// ─── Cleanup — run on extension load ──────────────────────────────────────────

export async function cleanupOldHistory() {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
  const fresh = sessionHistory.filter((e) => e.at > cutoff);
  if (fresh.length !== sessionHistory.length) {
    await chrome.storage.local.set({ sessionHistory: fresh });
  }
}

// ─── Build context block for Gemini ───────────────────────────────────────────
// Returns a string to prepend to the system prompt (or inject as context).

export async function buildMemoryContext() {
  const profile = await getUserProfile();
  const history = await getSessionHistory();

  const parts = [];

  // User profile
  if (profile.length) {
    const facts = profile.map((p) => p.fact).join('. ');
    parts.push(`Known facts about the user: ${facts}.`);
  }

  // Recent conversation (last 8 turns — enough for continuity, not too many tokens)
  const recent = history.slice(-8);
  if (recent.length) {
    const turns = recent
      .map((t) => `User: ${t.question}\nAssistant: ${t.response}`)
      .join('\n');
    parts.push(`Recent conversation:\n${turns}`);
  }

  return parts.join('\n\n');
}

// ─── Extract profile facts from a user message ───────────────────────────────
// Simple pattern-based extraction. Catches the most common "remember" patterns
// and implicit self-descriptions.

const FACT_PATTERNS = [
  /my name is (.+)/,
  /call me (.+)/,
  /i(?:'m| am) (.{2,40})/,
  /i live in (.+)/,
  /i(?:'m| am) from (.+)/,
  /i work (?:at|for|in) (.+)/,
  /my (?:email|phone|number) is (.+)/,
  /i (?:like|love|prefer|enjoy|hate|dislike) (.+)/,
  /i(?:'m| am) (?:a|an) (.{2,40})/,
  /my (?:favorite|favourite) (.+?) is (.+)/,
  /i speak (.+)/,
  /i use (.+)/,
  /remember (?:that )?(.+)/,
];

export function extractFacts(text) {
  const lower = text.toLowerCase().trim();
  const facts = [];

  for (const pattern of FACT_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      // Use the full matched portion as the fact, cleaned up
      const raw = match[0].trim();
      // Capitalize first letter
      const fact = raw.charAt(0).toUpperCase() + raw.slice(1);
      facts.push(fact);
    }
  }

  return facts;
}

// ─── High-level helper: process a turn ────────────────────────────────────────
// Call this after every final transcript + response pair.

export async function processTurn(question, response) {
  await saveTurn(question, response);

  // Extract and save any facts from what the user said
  const facts = extractFacts(question);
  for (const fact of facts) {
    await addProfileFact(fact);
  }
}
