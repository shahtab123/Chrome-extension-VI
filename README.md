# Voice AI Assistant for the Blind — Chrome Extension

A voice-controlled AI assistant for visually impaired users, built with **Manifest V3** and Chrome's built-in AI APIs (Gemini Nano).

---

## Project Structure

```
code/
├── manifest.json           # MV3 extension manifest
├── background.js           # Service worker — TTS, message routing, tab control
├── sidepanel.html          # Side panel UI
├── sidepanel.css           # Side panel styles (accessible dark theme)
├── sidepanel.js            # Side panel logic — voice recognition, UI state
├── content.js              # Content script — DOM reading & page interaction
│
├── voice/
│   ├── speechRecognition.js   # Web Speech API wrapper (SpeechRecognition)
│   └── speechSynthesis.js     # TTS helpers (chrome.tts + SpeechSynthesis fallback)
│
├── ai/
│   └── promptHandler.js       # Chrome Prompt API (Gemini Nano) + keyword fallback
│
├── browser/
│   └── tabsManager.js         # Tab query, open, close, screenshot utilities
│
├── content/
│   └── domReader.js           # DOM extraction: headings, links, tables, fields
│
└── images/
    ├── icon-16.png            # ← ADD manually (16×16 px)
    ├── icon-48.png            # ← ADD manually (48×48 px)
    └── icon-128.png           # ← ADD manually (128×128 px)
```

---

## Setup

### 1. Add icons
Place PNG icon files in `images/` at sizes `16`, `48`, and `128` px.  
A simple microphone or ear icon works well. You can generate them at [favicon.io](https://favicon.io).

### 2. Load the extension
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this `code/` folder

### 3. Open the side panel
Click the extension icon in the toolbar — the side panel opens on the right.

### 4. Keyboard shortcut
The default shortcut is **Ctrl + Shift + P** (toggles listening on/off).  
> **Note:** `Ctrl+P` is reserved by Chrome for printing and cannot be used directly.  
> You can remap the shortcut to anything you like at `chrome://extensions/shortcuts`.

---

## How it works

| Layer | File | Responsibility |
|---|---|---|
| **Side panel** | `sidepanel.js` | Runs Web Speech API, shows transcript & response |
| **Background** | `background.js` | Routes messages, speaks via `chrome.tts` |
| **Content script** | `content.js` | Reads DOM, scrolls, clicks, navigates |
| **AI** | `ai/promptHandler.js` | Gemini Nano Prompt API (falls back to keywords) |

### Message flow
```
User speaks
  → SpeechRecognitionWrapper (sidepanel)
    → handleCommand() (ai/promptHandler)
      → chrome.runtime.sendMessage SEND_TO_CONTENT
        → content.js performs DOM action
      → speak() → background SPEAK → chrome.tts
```

---

## Enabling Gemini Nano (Chrome Built-in AI)

1. Open `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
2. Open `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
3. Relaunch Chrome
4. Open `chrome://components` → find **Optimization Guide On Device Model** → click **Check for update**

Once available, `ai/promptHandler.js` will automatically use `window.ai.languageModel`.

---

## Next steps (roadmap)

- [ ] Wire `SCROLL_DOWN` / `SCROLL_UP` / `READ_PAGE` commands end-to-end
- [ ] Add user settings (reading speed, voice, language) stored in `chrome.storage`
- [ ] Implement page summarization using Summarization API
- [ ] Add Gmail / Google Docs content-script modules
- [ ] Vision: screenshot + Gemini vision model for "What's on screen?"
- [ ] Memory: conversation history in `chrome.storage.local`
