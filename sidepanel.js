// sidepanel.js — Side Panel UI logic (ES module)
import SpeechRecognitionWrapper from './voice/speechRecognition.js';
import { speak, stopSpeaking } from './voice/speechSynthesis.js';
import { handleCommand, getActiveAIMode } from './ai/promptHandler.js';
import {
  getAllKeys, addKey, removeKey, setActiveKey,
  getActiveKeyId, testApiKey, callGemini, maskKey,
} from './ai/geminiApi.js';
import { processTurn, cleanupOldHistory } from './ai/memory.js';
import { isGmailConnected, getAuthToken, removeCachedToken } from './browser/gmail.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const btnStart        = document.getElementById('btn-start');
const btnStop         = document.getElementById('btn-stop');
const statusBadge     = document.getElementById('status-badge');
const micLabel        = document.getElementById('mic-label');
const micRing         = document.getElementById('mic-ring');
const transcriptEl    = document.getElementById('transcript');
const responseEl      = document.getElementById('response');
const btnCommands     = document.getElementById('btn-commands');
const commandsPanel   = document.getElementById('commands-panel');
// Views
const viewMain     = document.getElementById('view-main');
const viewSettings = document.getElementById('view-settings');
const btnSettings  = document.getElementById('btn-settings');
const btnSettingsBack = document.getElementById('btn-settings-back');
const aiStatusDot     = document.getElementById('ai-status-dot');
const aiStatusText    = document.getElementById('ai-status-text');
const keysList        = document.getElementById('keys-list');
const keysEmpty       = document.getElementById('keys-empty');
const inputKeyLabel   = document.getElementById('input-key-label');
const inputApiKey     = document.getElementById('input-api-key');
const btnToggleKey    = document.getElementById('btn-toggle-key');
const btnSaveKey      = document.getElementById('btn-save-key');
const btnTestNewKey   = document.getElementById('btn-test-new-key');
const keyFeedback     = document.getElementById('key-feedback');
const voiceSelect     = document.getElementById('voice-select');
const voiceVolume     = document.getElementById('voice-volume');
const voiceVolumeValue = document.getElementById('voice-volume-value');
const btnTestVoice    = document.getElementById('btn-test-voice');
const gmailStatusDot  = document.getElementById('gmail-status-dot');
const gmailStatusText = document.getElementById('gmail-status-text');
const btnGmailConnect = document.getElementById('btn-gmail-connect');
const btnGmailDisconnect = document.getElementById('btn-gmail-disconnect');
const gmailFeedback   = document.getElementById('gmail-feedback');

// ─── State ────────────────────────────────────────────────────────────────────
let recognizer = null;
let listeningRequested = false;

// ─── Status badge + mic state ────────────────────────────────────────────────
const STATUS_LABELS = { idle: '', listening: 'Listening', processing: 'Processing', error: 'Error' };
const MIC_LABELS    = { idle: 'Tap to speak', listening: 'Listening…', processing: 'Processing…', error: 'Something went wrong' };

function setStatus(state) {
  statusBadge.textContent = STATUS_LABELS[state] ?? state;
  statusBadge.className   = `status-badge status--${state}`;
  micLabel.textContent    = MIC_LABELS[state] ?? state;

  // Mic button visual state
  btnStart.classList.toggle('btn-mic--listening', state === 'listening');
  micRing.classList.toggle('mic-ring--active',    state === 'listening');
}

// ─── Transcript ───────────────────────────────────────────────────────────────
function addTranscript(text, isInterim = false) {
  transcriptEl.querySelector('.s-empty')?.remove();

  if (isInterim) {
    let el = transcriptEl.querySelector('.transcript-entry--interim');
    if (!el) {
      el = document.createElement('p');
      el.className = 'transcript-entry transcript-entry--interim';
      transcriptEl.appendChild(el);
    }
    el.textContent = text;
  } else {
    transcriptEl.querySelector('.transcript-entry--interim')?.remove();
    const el = document.createElement('p');
    el.className = 'transcript-entry';
    el.textContent = text;
    transcriptEl.appendChild(el);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
}

// ─── Response box ─────────────────────────────────────────────────────────────
function showResponse(text) {
  responseEl.innerHTML = `<p class="response-text">${escHtmlPanel(text)}</p>`;
}
function escHtmlPanel(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Listening control ────────────────────────────────────────────────────────
function startListening() {
  if (!recognizer) {
    recognizer = new SpeechRecognitionWrapper({
      onInterim(text) {
        addTranscript(text, true);
      },

      async onFinal(text) {
        addTranscript(text);
        setStatus('processing');

        try {
          const result = await handleCommand(text);
          const response = typeof result === 'string' ? result : (result?.text ?? '');
          const skipSpeak = Boolean(result && typeof result === 'object' && result.skipSpeak);

          showResponse(response);
          await processTurn(text, response);

          if (!skipSpeak && response) {
            const { ttsRate = 1.0, ttsVolume = 1.0, ttsVoiceName = '' } =
              await chrome.storage.local.get(['ttsRate', 'ttsVolume', 'ttsVoiceName']);
            await speak(response, { rate: ttsRate, volume: ttsVolume, voiceName: ttsVoiceName || undefined });
          }
          setStatus('listening');
        } catch (err) {
          showResponse(`Error: ${err.message}`);
          setStatus('error');
        }
      },

      onError(errCode) {
        // 'no-speech' fires after silence — Chrome always follows it with onEnd
        // which will auto-restart if listeningRequested is true, so ignore it here.
        // 'aborted' means we called stop() ourselves — also safe to ignore.
        if (errCode === 'no-speech' || errCode === 'aborted') return;

        // Any real error (not-allowed, network, audio-capture, etc.) — stop fully.
        const errMap = {
          'not-allowed': 'Microphone access was blocked or no microphone is available. Connect a mic and allow microphone access in Chrome site settings.',
          'audio-capture': 'No microphone was detected. Please connect a microphone and try again.',
          'service-not-allowed': 'Speech recognition service is blocked by browser settings.',
          'network': 'Speech recognition is unavailable right now due to a network issue.',
        };
        const msg = errMap[errCode] ?? `Recognition error: ${errCode}`;
        showResponse(msg);
        chrome.storage.local
          .get(['ttsRate', 'ttsVolume', 'ttsVoiceName'])
          .then(({ ttsRate = 1.0, ttsVolume = 1.0, ttsVoiceName = '' }) =>
            speak(msg, { rate: ttsRate, volume: ttsVolume, voiceName: ttsVoiceName || undefined })
          )
          .catch(() => {});
        setStatus('error');
        listeningRequested = false;
        setListeningUI(false);
      },

      onEnd() {
        // SpeechRecognition may end after short silence even in `continuous` mode.
        // If the user is still "listening", we immediately restart.
        if (listeningRequested) {
          setListeningUI(true);
          try {
            recognizer.start();
          } catch {
            // Some browsers throw if start() happens too quickly; next onend will recover.
          }
        } else {
          setListeningUI(false);
        }
      },
    });
  }

  recognizer.start();
  listeningRequested = true;
  setListeningUI(true);
  chrome.runtime.sendMessage({ type: 'SET_LISTENING_STATE', isListening: true });
}

function stopListening() {
  listeningRequested = false;
  recognizer?.stop();
  stopSpeaking();
  setListeningUI(false);
  chrome.runtime.sendMessage({ type: 'SET_LISTENING_STATE', isListening: false });
}

function setListeningUI(isListening) {
  btnStart.disabled = isListening;
  btnStop.disabled  = !isListening;
  setStatus(isListening ? 'listening' : 'idle');
}

// ─── Button events ────────────────────────────────────────────────────────────
btnStart.addEventListener('click', startListening);
btnStop.addEventListener('click', stopListening);

btnCommands.addEventListener('click', () => {
  const isOpen = !commandsPanel.hidden;
  commandsPanel.hidden = isOpen;
  btnCommands.setAttribute('aria-expanded', String(!isOpen));
});

// ─── View switching: Main ↔ Settings ───────────────────────────────────────────
function showMainView() {
  viewMain.hidden = false;
  viewSettings.hidden = true;
  btnSettings.setAttribute('aria-expanded', 'false');
}

function showSettingsView() {
  viewMain.hidden = true;
  viewSettings.hidden = false;
  btnSettings.setAttribute('aria-expanded', 'true');
  refreshSettings();
}

btnSettings.addEventListener('click', showSettingsView);
btnSettingsBack.addEventListener('click', showMainView);

// Show/hide key value while typing
btnToggleKey.addEventListener('click', () => {
  const isPassword = inputApiKey.type === 'password';
  inputApiKey.type = isPassword ? 'text' : 'password';
  btnToggleKey.textContent = isPassword ? '🙈' : '👁';
});

// Add new key
btnSaveKey.addEventListener('click', async () => {
  const value = inputApiKey.value.trim();
  const label = inputKeyLabel.value.trim();
  if (!value) { setKeyFeedback('Paste an API key first.', 'error'); return; }

  btnSaveKey.disabled = true;
  await addKey(label, value);
  inputApiKey.value     = '';
  inputKeyLabel.value   = '';
  inputApiKey.type      = 'password';
  btnToggleKey.textContent = '👁';
  await refreshSettings();
  setKeyFeedback('✓ Key added.', 'ok');
  btnSaveKey.disabled = false;
});

// Test the key currently typed in the input (before saving)
btnTestNewKey.addEventListener('click', async () => {
  const value = inputApiKey.value.trim();
  if (!value) { setKeyFeedback('Paste a key to test it first.', 'error'); return; }
  setKeyFeedback('Testing…', 'info');
  btnTestNewKey.disabled = true;
  try {
    // Temporarily test by calling the API directly with this key
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${value}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
        }),
      }
    );
    if (res.ok) setKeyFeedback('✓ Key is valid and working.', 'ok');
    else {
      const err = await res.json().catch(() => ({}));
      setKeyFeedback(`✗ ${err?.error?.message ?? `HTTP ${res.status}`}`, 'error');
    }
  } catch (e) {
    setKeyFeedback(`✗ ${e.message}`, 'error');
  }
  btnTestNewKey.disabled = false;
});

function setKeyFeedback(msg, type = 'info') {
  keyFeedback.textContent = msg;
  keyFeedback.className   = `s-feedback s-feedback--${type}`;
}

// ─── Voice settings ───────────────────────────────────────────────────────────
function populateVoiceSelect(voices, selectedVoiceName = '') {
  if (!voiceSelect) return;
  voiceSelect.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Default voice';
  voiceSelect.appendChild(defaultOpt);

  const seen = new Set();
  voices
    .sort((a, b) => (a.lang + a.voiceName).localeCompare(b.lang + b.voiceName))
    .forEach((v) => {
      const key = `${v.voiceName}__${v.lang}`;
      if (seen.has(key)) return;
      seen.add(key);
      const opt = document.createElement('option');
      opt.value = v.voiceName;
      opt.textContent = `${v.voiceName} (${v.lang})${v.remote ? ' · remote' : ''}`;
      voiceSelect.appendChild(opt);
    });

  voiceSelect.value = selectedVoiceName || '';
}

async function loadVoiceSettings() {
  const { ttsVolume = 1.0, ttsVoiceName = '' } =
    await chrome.storage.local.get(['ttsVolume', 'ttsVoiceName']);

  const volumePct = Math.round(Math.min(1, Math.max(0, ttsVolume)) * 100);
  if (voiceVolume) voiceVolume.value = String(volumePct);
  if (voiceVolumeValue) voiceVolumeValue.textContent = `${volumePct}%`;

  if (chrome.tts?.getVoices) {
    chrome.tts.getVoices((voices) => {
      populateVoiceSelect(voices || [], ttsVoiceName);
    });
  }
}

if (voiceVolume) {
  voiceVolume.addEventListener('input', async () => {
    const pct = Number(voiceVolume.value);
    const volume = Math.min(1, Math.max(0, pct / 100));
    voiceVolumeValue.textContent = `${pct}%`;
    await chrome.storage.local.set({ ttsVolume: volume });
  });
}

if (voiceSelect) {
  voiceSelect.addEventListener('change', async () => {
    await chrome.storage.local.set({ ttsVoiceName: voiceSelect.value || '' });
  });
}

if (btnTestVoice) {
  btnTestVoice.addEventListener('click', async () => {
    btnTestVoice.disabled = true;
    try {
      const { ttsRate = 1.0, ttsVolume = 1.0, ttsVoiceName = '' } =
        await chrome.storage.local.get(['ttsRate', 'ttsVolume', 'ttsVoiceName']);
      await speak(
        'Hello. This is a test of your selected assistant voice and volume.',
        { rate: ttsRate, volume: ttsVolume, voiceName: ttsVoiceName || undefined }
      );
      setKeyFeedback('Voice test played.', 'ok');
    } catch (err) {
      setKeyFeedback(`Voice test failed: ${err.message}`, 'error');
    } finally {
      btnTestVoice.disabled = false;
    }
  });
}

// ─── Gmail connection ─────────────────────────────────────────────────────────

async function refreshGmailStatus() {
  const connected = await isGmailConnected();
  if (gmailStatusDot) gmailStatusDot.className = `ai-dot ai-dot--${connected ? 'gemini-api' : 'none'}`;
  if (gmailStatusText) gmailStatusText.textContent = connected ? 'Connected' : 'Not connected';
  if (btnGmailConnect) btnGmailConnect.hidden = connected;
  if (btnGmailDisconnect) btnGmailDisconnect.hidden = !connected;
}

if (btnGmailConnect) {
  btnGmailConnect.addEventListener('click', async () => {
    btnGmailConnect.disabled = true;
    if (gmailFeedback) { gmailFeedback.textContent = 'Signing in…'; gmailFeedback.className = 's-feedback s-feedback--info'; }
    try {
      await getAuthToken(true);
      if (gmailFeedback) { gmailFeedback.textContent = 'Connected.'; gmailFeedback.className = 's-feedback s-feedback--ok'; }
      await refreshGmailStatus();
    } catch (err) {
      if (gmailFeedback) { gmailFeedback.textContent = err.message; gmailFeedback.className = 's-feedback s-feedback--error'; }
    } finally {
      btnGmailConnect.disabled = false;
    }
  });
}

if (btnGmailDisconnect) {
  btnGmailDisconnect.addEventListener('click', async () => {
    btnGmailDisconnect.disabled = true;
    try {
      const token = await getAuthToken(false);
      if (token) await removeCachedToken(token);
    } catch { /* already disconnected */ }
    await chrome.storage.local.remove(['gmailList', 'gmailCurrentId']);
    if (gmailFeedback) { gmailFeedback.textContent = 'Disconnected. Sign-in will open automatically next time you use an email command.'; gmailFeedback.className = 's-feedback s-feedback--info'; }
    await refreshGmailStatus();
    btnGmailDisconnect.disabled = false;
  });
}

// ─── Keys list renderer ───────────────────────────────────────────────────────

async function renderKeysList() {
  const keys        = await getAllKeys();
  const activeId    = await getActiveKeyId();

  // Clear existing key items (keep the empty placeholder)
  keysList.querySelectorAll('.key-item').forEach((el) => el.remove());

  if (!keys.length) {
    keysEmpty.hidden = false;
    return;
  }
  keysEmpty.hidden = true;

  keys.forEach((k) => {
    const isActive = k.id === activeId || (!activeId && keys[0]?.id === k.id);

    const item = document.createElement('div');
    item.className  = `key-item${isActive ? ' key-item--active' : ''}`;
    item.setAttribute('role', 'listitem');
    item.dataset.id = k.id;

    item.innerHTML = `
      <span class="key-active-dot" aria-hidden="true"></span>
      <div class="key-info">
        <span class="key-label">${escHtml(k.label)}</span>
        <span class="key-masked">${maskKey(k.value)}</span>
      </div>
      <div class="key-actions">
        ${isActive
          ? `<span class="key-btn key-btn--active-label" aria-label="Active key">Active</span>`
          : `<button class="key-btn key-btn--activate" data-action="activate" data-id="${k.id}" aria-label="Set ${escHtml(k.label)} as active key">Set Active</button>`
        }
        <button class="key-btn key-btn--remove" data-action="remove" data-id="${k.id}" aria-label="Remove ${escHtml(k.label)}">Remove</button>
      </div>`;

    keysList.appendChild(item);
  });

  // Delegate click events
  keysList.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    if (action === 'activate') {
      await setActiveKey(id);
      await refreshSettings();
    } else if (action === 'remove') {
      await removeKey(id);
      await refreshSettings();
      setKeyFeedback('Key removed.', 'info');
    }
  };
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── AI status indicator ──────────────────────────────────────────────────────

async function refreshSettings() {
  await renderKeysList();
  await loadVoiceSettings();
  await refreshGmailStatus();
  const mode = await getActiveAIMode();
  const labels = {
    'built-in':   '✓ Chrome Built-in AI (on-device)',
    'gemini-api': '✓ Gemini API — key active',
    'none':       '✗ No AI configured',
  };
  aiStatusDot.className    = `ai-dot ai-dot--${mode}`;
  aiStatusText.textContent = labels[mode] ?? 'Unknown';
}

// Initialise on load
cleanupOldHistory();
refreshSettings();

// ─── Keyboard shortcut relay from background ──────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TOGGLE_LISTENING') {
    btnStart.disabled ? stopListening() : startListening();
  }
});
