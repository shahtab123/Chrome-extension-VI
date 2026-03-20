// ai/geminiApi.js
// Gemini API — supports multiple saved keys, one active at a time.
// Storage schema:
//   geminiKeys:   [{ id, label, value, addedAt }]
//   activeKeyId:  string | null

import { buildMemoryContext } from './memory.js';

const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT =
  'You are a voice assistant built into a Chrome extension called Voice Assistant, designed to help blind and visually impaired users. ' +
  'Your job is to assist with any task in Chrome and on the web — reading pages, navigating tabs, answering questions, summarising content, and more. ' +
  'IMPORTANT IDENTITY RULES: Never say you are made by Google, never mention Gemini, never say you are a large language model. ' +
  'If asked who you are, say: I am your Voice Assistant, here to help you with anything in Chrome. ' +
  'If asked who made you, say: I was built as part of the Voice Assistant Chrome extension. ' +
  'Respond in plain spoken language only — no markdown, no bullet points, no symbols, no emojis. ' +
  'Keep answers under three sentences unless the user asks you to read or summarise content. ' +
  'Be warm, direct, and clear.';

// ─── Storage helpers ──────────────────────────────────────────────────────────

/** Returns all saved keys. */
export async function getAllKeys() {
  await migrateLegacyKey();
  const { geminiKeys = [] } = await chrome.storage.local.get('geminiKeys');
  return geminiKeys;
}

/** Returns the currently active key value, or null. */
export async function getApiKey() {
  const keys     = await getAllKeys();
  if (!keys.length) return null;
  const { activeKeyId } = await chrome.storage.local.get('activeKeyId');
  const active = keys.find((k) => k.id === activeKeyId) ?? keys[0];
  return active?.value ?? null;
}

/** Returns the active key id, or null. */
export async function getActiveKeyId() {
  const { activeKeyId } = await chrome.storage.local.get('activeKeyId');
  return activeKeyId ?? null;
}

/**
 * Adds a new key. Makes it active if it's the first one.
 * @param {string} label
 * @param {string} value
 * @returns {string} new key id
 */
export async function addKey(label, value) {
  const keys = await getAllKeys();
  const id   = `key_${Date.now()}`;
  keys.push({ id, label: label.trim() || `Key ${keys.length + 1}`, value: value.trim(), addedAt: Date.now() });
  await chrome.storage.local.set({ geminiKeys: keys });
  // Auto-activate if first key
  const { activeKeyId } = await chrome.storage.local.get('activeKeyId');
  if (!activeKeyId) await chrome.storage.local.set({ activeKeyId: id });
  return id;
}

/**
 * Removes a key by id. If it was active, activates the next available key.
 * @param {string} id
 */
export async function removeKey(id) {
  let keys = await getAllKeys();
  keys     = keys.filter((k) => k.id !== id);
  await chrome.storage.local.set({ geminiKeys: keys });
  const { activeKeyId } = await chrome.storage.local.get('activeKeyId');
  if (activeKeyId === id) {
    await chrome.storage.local.set({ activeKeyId: keys[0]?.id ?? null });
  }
}

/**
 * Sets the active key by id.
 * @param {string} id
 */
export async function setActiveKey(id) {
  await chrome.storage.local.set({ activeKeyId: id });
}

/** Migrate old single-key storage format to the new multi-key format. */
async function migrateLegacyKey() {
  const { geminiApiKey, geminiKeys } = await chrome.storage.local.get(['geminiApiKey', 'geminiKeys']);
  if (geminiApiKey && !geminiKeys) {
    const id = `key_${Date.now()}`;
    await chrome.storage.local.set({
      geminiKeys:  [{ id, label: 'Default Key', value: geminiApiKey, addedAt: Date.now() }],
      activeKeyId: id,
    });
    await chrome.storage.local.remove('geminiApiKey');
  }
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * Calls the Gemini API.
 * @param {string} userMessage
 * @param {string} [pageContext]
 * @returns {Promise<string>}
 */
export async function callGemini(userMessage, pageContext = '') {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('No Gemini API key set. Add one in ⚙️ Settings.');

  const memoryBlock  = await buildMemoryContext();
  const contextBlock = pageContext
    ? `Current page content:\n${pageContext.slice(0, 3000)}\n\n`
    : '';

  const systemText = memoryBlock
    ? `${SYSTEM_PROMPT}\n\n${memoryBlock}`
    : SYSTEM_PROMPT;

  const payload = {
    system_instruction: { parts: [{ text: systemText }] },
    contents: [{
      role:  'user',
      parts: [{ text: `${contextBlock}${userMessage}` }],
    }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
  };

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  return text.trim();
}

/**
 * Tests the currently active key.
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function testApiKey() {
  try {
    await callGemini('Reply with the single word: ready');
    return { ok: true, message: 'Connected successfully.' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/** Returns a masked display string: first 8 chars + … + last 4 chars */
export function maskKey(value) {
  if (!value || value.length < 12) return '••••••••••••';
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
