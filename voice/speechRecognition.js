// voice/speechRecognition.js
// Wraps the Web Speech API SpeechRecognition for use in the side panel context.
// Service workers do NOT have access to the microphone; this must run in a page/panel.

export default class SpeechRecognitionWrapper {
  #recognition = null;
  #callbacks    = {};
  #started      = false;

  /**
   * @param {{
   *   onInterim?: (text: string) => void,
   *   onFinal?:   (text: string) => void,
   *   onError?:   (code: string) => void,
   *   onEnd?:     () => void,
   *   lang?:      string,
   * }} callbacks
   */
  constructor(callbacks = {}) {
    this.#callbacks = callbacks;
    this.#init();
  }

  #init() {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      throw new Error(
        'Web Speech API is not available. ' +
        'Enable chrome://flags/#on-device-speech-recognition for on-device support.'
      );
    }

    const r = new SR();
    r.continuous      = true;
    r.interimResults  = true;
    r.lang            = this.#callbacks.lang ?? 'en-US';
    r.maxAlternatives = 1;

    r.onresult = (event) => {
      let interim = '';
      let final   = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (interim) this.#callbacks.onInterim?.(interim.trim());
      if (final)   this.#callbacks.onFinal?.(final.trim());
    };

    r.onerror = (event) => {
      this.#started = false;
      this.#callbacks.onError?.(event.error);
    };

    r.onend = () => {
      this.#started = false;
      this.#callbacks.onEnd?.();
    };

    this.#recognition = r;
  }

  start() {
    if (this.#started) return;
    this.#recognition.start();
    this.#started = true;
  }

  stop() {
    if (!this.#started) return;
    this.#recognition.stop();
    this.#started = false;
  }

  abort() {
    this.#recognition?.abort();
    this.#started = false;
  }

  get isListening() {
    return this.#started;
  }
}
