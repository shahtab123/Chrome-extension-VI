// sidepanel.js — Side Panel UI logic (ES module)
import SpeechRecognitionWrapper from './voice/speechRecognition.js';
import { speak, stopSpeaking } from './voice/speechSynthesis.js';
import { handleCommand } from './ai/promptHandler.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const btnStart      = document.getElementById('btn-start');
const btnStop       = document.getElementById('btn-stop');
const statusBadge   = document.getElementById('status-badge');
const transcriptEl  = document.getElementById('transcript');
const responseEl    = document.getElementById('response');
const btnCommands   = document.getElementById('btn-commands');
const commandsPanel = document.getElementById('commands-panel');

// ─── State ────────────────────────────────────────────────────────────────────
let recognizer = null;

// ─── Status badge ─────────────────────────────────────────────────────────────
function setStatus(state) {
  statusBadge.textContent = state.charAt(0).toUpperCase() + state.slice(1);
  statusBadge.className   = `badge badge--${state}`;
}

// ─── Transcript ───────────────────────────────────────────────────────────────
function addTranscript(text, isInterim = false) {
  // Remove empty-state placeholder
  transcriptEl.querySelector('.placeholder')?.remove();

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
  responseEl.innerHTML = `<p class="response-text">${text}</p>`;
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
          const response = await handleCommand(text);
          showResponse(response);
          await speak(response);
          setStatus('listening');
        } catch (err) {
          showResponse(`Error: ${err.message}`);
          setStatus('error');
        }
      },

      onError(errCode) {
        showResponse(`Recognition error: ${errCode}`);
        setStatus('error');
        setListeningUI(false);
      },

      onEnd() {
        // Auto-reset unless we explicitly set a terminal state
        if (!['error', 'idle'].includes(statusBadge.dataset.state)) {
          setListeningUI(false);
        }
      },
    });
  }

  recognizer.start();
  setListeningUI(true);
  chrome.runtime.sendMessage({ type: 'SET_LISTENING_STATE', isListening: true });
}

function stopListening() {
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

// ─── Keyboard shortcut relay from background ──────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TOGGLE_LISTENING') {
    btnStart.disabled ? stopListening() : startListening();
  }
});
