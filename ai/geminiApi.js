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
 * Use Gemini to draft an email reply or compose a new email.
 * Returns { subject, body } — plain text, ready to send.
 */
export async function draftEmailWithAI({ intent, originalEmail, recipientAddress, userName }) {
  const apiKey = await getApiKey();
  if (!apiKey) return null; // no key — caller will fall back to raw text

  const senderName = userName || 'the user';
  let prompt;

  if (originalEmail) {
    prompt =
      `You are writing an email reply on behalf of ${senderName}.\n\n` +
      `ORIGINAL EMAIL:\nFrom: ${originalEmail.from}\nSubject: ${originalEmail.subject}\nDate: ${originalEmail.date}\n` +
      `Body:\n${(originalEmail.body || originalEmail.snippet || '').slice(0, 1500)}\n\n` +
      `USER'S INTENT FOR THE REPLY: "${intent}"\n\n` +
      `Write a clear, professional, friendly reply. Keep it concise. Do NOT include a subject line — only the body text. ` +
      `Sign off with the user's name if known. No markdown, no formatting symbols.`;
  } else {
    prompt =
      `You are composing a new email on behalf of ${senderName} to ${recipientAddress}.\n\n` +
      `USER'S INTENT: "${intent}"\n\n` +
      `Write the email. First line: "Subject: <your chosen subject>"\n` +
      `Then a blank line, then the body. Keep it concise, professional, and friendly. ` +
      `Sign off with the user's name if known. No markdown, no formatting symbols.`;
  }

  const payload = {
    system_instruction: { parts: [{ text: 'You are an email writing assistant. Write natural, professional emails. No markdown. Plain text only.' }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
  };

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) return null;

  if (originalEmail) {
    return { body: text };
  }

  const subjectMatch = text.match(/^Subject:\s*(.+)/im);
  const subject = subjectMatch ? subjectMatch[1].trim() : 'Message from Voice Assistant';
  const body = text.replace(/^Subject:\s*.+\n*/im, '').trim();
  return { subject, body };
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

/**
 * Generate document content using Gemini.
 *
 * Modes:
 *   1. Write from scratch: pass { topic, style, instructions }
 *   2. Append a section:   pass { existingContent, appendInstructions }
 *   3. Rewrite / edit:     pass { existingContent, editInstructions }
 *
 * Returns plain text string (no markdown) ready to write into a Google Doc.
 * Throws if no API key is configured.
 */
export async function generateDocContent({ topic, style, instructions, existingContent, appendInstructions, editInstructions }) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('No Gemini API key set. Add one in Settings to use AI document writing.');

  let prompt;

  if (editInstructions && existingContent) {
    // Mode 3 — edit / rewrite existing document
    prompt =
      `You are editing a Google Doc on behalf of the user.\n\n` +
      `CURRENT DOCUMENT CONTENT:\n${existingContent.slice(0, 4000)}\n\n` +
      `USER INSTRUCTION: "${editInstructions}"\n\n` +
      `Write the complete updated document. Return ONLY the document body text — ` +
      `no headings like "Here is your document:", no markdown symbols, no bullet dashes unless the user asked for them. ` +
      `Plain prose, ready to save directly into Google Docs.`;
  } else if (appendInstructions && existingContent) {
    // Mode 2 — append a new section
    prompt =
      `You are adding content to an existing Google Doc.\n\n` +
      `EXISTING DOCUMENT (for context):\n${existingContent.slice(0, 3000)}\n\n` +
      `USER WANTS TO ADD: "${appendInstructions}"\n\n` +
      `Write ONLY the new section to be appended — not the full document again. ` +
      `Match the tone and style of the existing content. Plain text only, no markdown.`;
  } else {
    // Mode 1 — write from scratch
    const styleNote = style ? `Style: ${style}.` : 'Style: clear, informative, and well-structured.';
    const extra     = instructions ? `\nAdditional instructions: ${instructions}` : '';
    prompt =
      `Write a complete, well-structured document about: "${topic}".\n` +
      `${styleNote}${extra}\n\n` +
      `Return ONLY the document body text — no preamble like "Here is your document:", ` +
      `no markdown formatting symbols, no bullet dashes unless the content calls for them. ` +
      `Plain prose ready to save directly into Google Docs.`;
  }

  const payload = {
    system_instruction: {
      parts: [{ text: 'You are an expert document writer. Write clear, complete, well-structured documents. Return only the document text — no commentary, no markdown, no formatting symbols.' }],
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Gemini returned an empty response.');
  return text;
}

/**
 * General-purpose structured JSON extractor using Gemini.
 * Useful for parsing dates, event details, doc names etc. from free-form speech.
 * Returns parsed JS object or null on failure.
 */
export async function parseWithAI(prompt) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: 'You are a data extraction assistant. Return ONLY valid JSON with no markdown, no code fences, no explanation.' }],
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  if (!raw) return null;

  try {
    // Strip optional markdown code fences if the model includes them
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/** Returns a masked display string: first 8 chars + … + last 4 chars */
export function maskKey(value) {
  if (!value || value.length < 12) return '••••••••••••';
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
