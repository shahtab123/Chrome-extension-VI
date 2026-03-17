// voice/speechSynthesis.js
// Two TTS strategies:
//   1. speak()      — uses chrome.tts via background (preferred; supports more voices & events)
//   2. speakLocal() — uses Web Speech SpeechSynthesisUtterance directly in the panel

/**
 * Ask the background service worker to speak via chrome.tts.
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, volume?: number }} [options]
 */
export function speak(text, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type:   'SPEAK',
        text,
        rate:   options.rate   ?? 1.0,
        pitch:  options.pitch  ?? 1.0,
        volume: options.volume ?? 1.0,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );
  });
}

/** Stop any ongoing TTS playback. */
export function stopSpeaking() {
  chrome.runtime.sendMessage({ type: 'STOP_SPEAKING' });
}

/**
 * Browser-side TTS fallback using SpeechSynthesisUtterance.
 * Useful when the background is unavailable (e.g., during development).
 * @param {string} text
 * @param {{ rate?: number, pitch?: number, volume?: number, voice?: string }} [options]
 */
export function speakLocal(text, options = {}) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('SpeechSynthesis API not available.'));
      return;
    }

    window.speechSynthesis.cancel();

    const utterance    = new SpeechSynthesisUtterance(text);
    utterance.rate     = options.rate   ?? 1.0;
    utterance.pitch    = options.pitch  ?? 1.0;
    utterance.volume   = options.volume ?? 1.0;

    if (options.voice) {
      const voices      = window.speechSynthesis.getVoices();
      const match       = voices.find((v) => v.name === options.voice);
      if (match) utterance.voice = match;
    }

    utterance.onend   = () => resolve();
    utterance.onerror = (e) => reject(new Error(e.error));

    window.speechSynthesis.speak(utterance);
  });
}

/** Returns available voices (browser-side). */
export function getVoices() {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    if (voices.length) { resolve(voices); return; }
    // Voices may load asynchronously
    window.speechSynthesis.onvoiceschanged = () =>
      resolve(window.speechSynthesis.getVoices());
  });
}
