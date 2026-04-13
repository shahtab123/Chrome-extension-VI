# Voice AI Assistant for the Blind

A voice-controlled assistant for visually impaired users. **Chrome extension** (Manifest V3) with a **side panel** UI: tap the mic or use a keyboard shortcut to speak; the assistant answers using Chrome APIs for browser tasks and **Gemini API** (or Chrome Built-in AI when available) for open-ended questions.

---

## Getting started for new users

Follow these steps the first time you use the extension.

1. **Install** — Load the unpacked folder in Chrome (see [Setup » 1. Load the extension](#1-load-the-extension)).
2. **Open the assistant** — Click the extension icon to open the **side panel**, or press **Alt+Shift+1** to toggle listening (see [Keyboard shortcut](#4-keyboard-shortcut)).
3. **Microphone** — Tap **Start listening**. When Chrome asks, **Allow** the microphone. If recognition fails with “blocked”, open the site settings for the extension and allow the mic.
4. **Gemini API (strongly recommended)** — In Settings (gear icon), add a free API key so open-ended questions work and **Gmail replies / new emails can be drafted by AI** from short spoken instructions. See [Setup » 3](#3-optional-add-a-gemini-api-key).
5. **Google account (Gmail + more)** — If you are the **developer** distributing the extension, you must create a Google Cloud project, enable the **Google APIs** you need (Gmail, and optionally Drive, Docs, Calendar — see [Setup » 5](#5-google-oauth-setup-gmail-now-drivedocscalendar-ready)), and put an **OAuth client ID** (Chrome Extension type) in `manifest.json`. End users then only complete a one-time Google sign-in (and again if you add new scopes later). See [Gmail setup checklist (step-by-step)](#gmail-setup-checklist-step-by-step-for-developers) and [OAuth scopes: what they are and how to add them](#oauth-scopes-what-they-are-and-how-to-add-them) below.
6. **Voice settings** — In Settings, pick **Voice** and **Volume**, and use **Test Voice** to confirm `chrome.tts` sounds right.
7. **Discover commands** — Expand **Commands** in the side panel, or open the full reference: **[COMMAND_REFERENCE.md](COMMAND_REFERENCE.md)**.

### Gmail setup checklist (step-by-step for developers)

Use this so “check my email”, “open Gmail”, and related voice commands work for everyone who installs your build.

| Step | What to do |
|------|------------|
| 1 | Go to [Google Cloud Console](https://console.cloud.google.com/) → create or select a **project**. |
| 2 | **APIs & Services** → **Library** → enable **Gmail API**. Also enable **Google Drive API**, **Google Docs API**, and **Google Calendar API** if your build uses those features (the extension’s `manifest.json` may request their scopes — each API must be enabled or requests will fail). |
| 3 | **OAuth consent screen** → choose **External** (or Internal for Workspace-only) → add app name, support email, developer contact. |
| 4 | On the consent screen, add **scopes** that **exactly match** `manifest.json` under `oauth2` → `scopes` (see [OAuth scopes: what they are and how to add them](#oauth-scopes-what-they-are-and-how-to-add-them) for the full list and meanings). |
| 5 | **Test users** — While the app is in testing, add Google accounts that may sign in. |
| 6 | **Credentials** → **Create credentials** → **OAuth client ID** → application type **Chrome extension** → paste your **Extension ID** from `chrome://extensions` (Developer mode on). |
| 7 | Copy the **Client ID** (ends with `.apps.googleusercontent.com`) into `manifest.json` → `oauth2` → `client_id`. |
| 8 | **Reload** the extension on `chrome://extensions`. |
| 9 | Sign in once: say **“check my email”** or open **Settings** → **Connect Gmail**. |

**End users** do not edit Cloud Console; they only approve the permission screen the first time they use email features.

**AI-written replies** — With a Gemini key saved, phrases like “reply with a detailed apology” use the original email as context and send a full reply. Without a key, the spoken text is sent as-is.

### OAuth scopes: what they are and how to add them

**What scopes are** — They are permission strings Google shows on the consent screen (“This extension can …”). Your extension declares them in `manifest.json` under `oauth2` → `scopes`. The **OAuth consent screen** in Google Cloud must list the **same** scopes, or users may see errors when signing in.

**How a new developer adds them (checklist)**

1. Open [Google Cloud Console](https://console.cloud.google.com/) → select your project.
2. **APIs & Services** → **Library** → enable every API you need: **Gmail API**, **Google Drive API**, **Google Docs API**, **Google Calendar API** (enable each one you will call from code).
3. **APIs & Services** → **OAuth consent screen** → edit your app → **Scopes** → **Add or remove scopes** → add each scope URL below (or paste the list from your repo’s `manifest.json` so it always matches).
4. **Credentials** — keep your single **OAuth client ID** of type **Chrome Extension** (same extension ID as in `chrome://extensions`).
5. Reload the extension; the next Google sign-in may ask users to approve **new** permissions if you added scopes.

**Scopes currently declared in `manifest.json` (and what each is for)**

| Scope | Purpose |
|-------|---------|
| `https://www.googleapis.com/auth/gmail.readonly` | Read email messages and settings |
| `https://www.googleapis.com/auth/gmail.send` | Send email on the user’s behalf |
| `https://www.googleapis.com/auth/gmail.modify` | Read, compose, send, archive, trash, labels (broader Gmail access) |
| `https://www.googleapis.com/auth/drive.readonly` | List and read Drive files (e.g. find Docs by name) |
| `https://www.googleapis.com/auth/drive.file` | Access files the app creates or opens with the user (narrower write surface than full Drive) |
| `https://www.googleapis.com/auth/documents.readonly` | Read Google Docs document content via the Docs API |
| `https://www.googleapis.com/auth/calendar.readonly` | Read calendars and events |
| `https://www.googleapis.com/auth/calendar.events` | Create, update, or delete calendar events |

**Notes for new users**

- The **OAuth client ID** in `manifest.json` is not a secret like a Gemini API key; it is tied to your **extension ID**. Do **not** put **client secrets** or **Gemini keys** in the public repo — use Settings in the extension for API keys.
- **Drive / Docs / Calendar voice features** require both: APIs enabled in Cloud Console, scopes in consent screen + `manifest.json`, and **code** that calls those APIs (Gmail is already implemented; others can be added over time).

---

## Features

- **Voice in, speech out** — Web Speech API for recognition, `chrome.tts` for responses
- **No-AI commands** — Tabs, time, date, page reading, scroll, back/forward, memory (name), all work without any API key
- **Site-aware search** — Says "search for cats" and it uses the current site's URL search (YouTube, Google, Amazon, etc.) — no DOM hacking
- **YouTube controls** — Play, pause, skip, rewind, captions, fullscreen, speed, trending, subscriptions — all via keyboard simulation
- **Page interaction** — Type into inputs, click buttons by text, focus search, clear fields — DOM-based, zero cost
- **Conversation memory** — Auto-learns facts about you, remembers recent history, builds context for every Gemini call
- **Gemini API (cloud)** — Add one or more API keys in Settings; choose which key is active. Free tier: 1,500 requests/day
- **Chrome Built-in AI (optional)** — If Gemini Nano is enabled (~22 GB disk), it is used first; otherwise Gemini API
- **Side panel UI** — Black & white glassmorphism design; circular mic with pulse animation when listening; Settings as full-screen view with back button
- **Keyboard shortcut** — **Alt+Shift+1** toggles listening (configurable at `chrome://extensions/shortcuts`)
- **Gmail (OAuth)** — Read inbox, unread count, paginated lists, read by number, next/previous, search, star, important, archive, trash, reply and compose (with optional **AI drafting** via Gemini when a key is set)
- **Google Drive + Docs** — List, search, open, and read Google Docs by name or number; create new docs; "read this doc" on any open Google Doc tab; paginated reading with "continue reading"
- **Google Calendar** — Read today/tomorrow/this week/next week; next event; events on a specific date; create events from natural speech (AI parses date, time, title, location); delete events
- **Voice output settings** — Choose TTS voice and volume in Settings; test button for quick verification

---

## Project Structure

```
code/
├── manifest.json           # MV3, side panel, permissions, commands
├── background.js           # Service worker — TTS, message routing, tab control
├── sidepanel.html          # Main view + Settings view (full-screen)
├── sidepanel.css           # Glassmorphism, mic ring, cards
├── sidepanel.js            # Voice UI, view switching, settings logic
├── content.js              # Content script — DOM read, scroll, page interaction
│
├── voice/
│   ├── speechRecognition.js   # Web Speech API (continuous, interim results)
│   └── speechSynthesis.js     # chrome.tts + SpeechSynthesis fallback
│
├── ai/
│   ├── promptHandler.js       # 4-layer routing: Chrome API → page actions → Built-in AI → Gemini API
│   ├── geminiApi.js           # Gemini 2.5 Flash API; multi-key storage, active key
│   └── memory.js              # Conversation memory — profile facts, session history, context builder
│
├── browser/
│   ├── tabsManager.js         # getActiveTab, openTab, closeTab, captureTab
│   ├── gmail.js               # Gmail REST API + chrome.identity OAuth
│   ├── drive.js               # Google Drive + Docs API (list, search, read, create, export)
│   └── calendar.js            # Google Calendar API (events, create, delete, date parsing)
│
├── content/
│   └── domReader.js           # readPageContent, getLinks, getStructuredContent
│
├── images/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
│
├── project plan.md           # Full product & roadmap
├── COMMAND_REFERENCE.md    # Full list of voice commands and behavior
└── README.md                 # This file
```

---

## Setup

### 1. Load the extension
1. Open Chrome → `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `code/` folder

### 2. Open the side panel
Click the extension icon in the toolbar. The side panel opens on the right.

### 3. (Optional) Add a Gemini API key
1. In the side panel, click the **gear** icon → Settings (full-screen).
2. Get a free key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
3. Add a label (e.g. Personal) and paste the key → **Add Key**. You can add multiple keys and choose which one is **Active**; use **Remove** to delete a key.
4. Click the **back arrow** to return to the main view.

### 4. Keyboard shortcut
Default: **Alt+Shift+1** toggles listening. To change it: `chrome://extensions/shortcuts` → find the extension → set **Toggle voice listening on/off**.

### 5. Google OAuth setup (Gmail now, Drive/Docs/Calendar ready)

Use this once so Google account features work in production.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create/select your project.
2. Enable APIs:
   - **Gmail API** (required now)
   - **Google Drive API** (future)
   - **Google Docs API** (future)
   - **Google Calendar API** (future)
   - **Also enable in Library when you use them:** **Google Drive API**, **Google Docs API**, and **Google Calendar API** are declared in `manifest.json` scopes — turn each API **On** in the same project so REST calls succeed once voice features use them. (The “future” bullets above refer to product features in code; the APIs themselves should still be enabled in Cloud if those scopes are in your manifest.)
3. Configure **OAuth consent screen** (External app), fill app info, and add scopes.
4. Create **OAuth client ID** of type **Chrome Extension** and use your extension ID from `chrome://extensions`.
5. Put the generated client ID into `manifest.json` under `oauth2.client_id`.

Recommended OAuth scopes:

- Gmail (current):  
  - `https://www.googleapis.com/auth/gmail.readonly`  
  - `https://www.googleapis.com/auth/gmail.send`  
  - `https://www.googleapis.com/auth/gmail.modify`
- Drive/Docs (future):  
  - `https://www.googleapis.com/auth/drive.readonly`  
  - `https://www.googleapis.com/auth/drive.file`  
  - `https://www.googleapis.com/auth/documents.readonly`
- Calendar (future):  
  - `https://www.googleapis.com/auth/calendar.readonly`  
  - `https://www.googleapis.com/auth/calendar.events`

**Canonical list** — The extension’s source of truth is `manifest.json` → `oauth2` → `scopes`. Keep the Cloud Console consent screen in sync with that array. For a plain-English table of each scope, see [OAuth scopes: what they are and how to add them](#oauth-scopes-what-they-are-and-how-to-add-them) above.

Sign-in behavior:
- First use opens a Google sign-in/consent popup.
- After approval, token is cached by Chrome; users do not need to sign in each time.

### 6. Side panel: Settings overview

- **AI status** — Shows whether Chrome Built-in AI or Gemini API is active.
- **Gmail** — **Connect Gmail** / **Disconnect** and connection status (same account flow as voice “check my email”).
- **Voice** — Dropdown for `chrome.tts` voice, volume slider, **Test Voice**.
- **API keys** — Add, test, activate, and remove Gemini keys.

---

## How it works

### Command routing (4 layers)
1. **Chrome API** — "How many tabs?", "What page am I on?", "What time is it?", "Remember my name is …" → answered with `chrome.tabs` / `chrome.storage` / `Date`
2. **Page actions** — "Read this page", "Scroll down", "Go back", "List the links", "Summarize" → content script acts on the active tab
3. **Chrome Built-in AI** — If Gemini Nano is available (see below), used for open-ended questions
4. **Gemini API** — If an API key is set in Settings, used for everything else (e.g. "Explain this", "Draft an email")

### Message flow
```
User speaks (mic or Alt+Shift+1)
  → sidepanel.js (SpeechRecognitionWrapper)
    → ai/promptHandler.js (handleCommand)
      → Layer 1–2: Chrome API / content script
      → Layer 3: window.ai.languageModel (Gemini Nano)
      → Layer 4: ai/geminiApi.js (Gemini 2.5 Flash)
    → background.js (SPEAK) → chrome.tts
    → content.js (SEND_TO_CONTENT) for read/scroll/links/page interaction
```

### UI
- **Main view**: Header (title + settings gear), circular mic (pulse ring when listening), Stop button, shortcut hint, status pill, Commands list (with all categories), Transcript, Response.
- **Settings view**: Back arrow + "Settings" header, then AI status, Gmail connect/disconnect, voice settings (voice, volume, test), saved keys list (with Set Active / Remove), and Add Key form.

---

## Full command list

Every phrase the extension tries to match is documented in **[COMMAND_REFERENCE.md](COMMAND_REFERENCE.md)** (grouped by category, with notes on Gmail, YouTube, and AI). The side panel **Commands** section is a shorter quick reference.

---

## Site-Aware URL Search

When you say **"search for …"** or **"type …"**, the extension checks which site you're on and uses the site's native URL-based search instead of injecting into the DOM. This is faster, more reliable, and works on every SPA.

| Site | URL Pattern |
|------|-------------|
| YouTube | `/results?search_query=` |
| Google | `/search?q=` |
| Bing | `/search?q=` |
| DuckDuckGo | `/?q=` |
| Wikipedia | `/wiki/Special:Search?search=` |
| Amazon | `/s?k=` |
| Reddit | `/search/?q=` |
| GitHub | `/search?q=` |
| Twitter/X | `/search?q=` |
| eBay | `/sch/i.html?_nkw=` |
| Netflix | `/search?q=` |
| Spotify | `/search/` |

You can also search cross-site from any page: **"Search YouTube for cooking"** navigates directly.

If you're on an unknown site, the extension falls back to DOM-based input detection, then to a Google search.

---

## Video Browsing (Paginated)

Works on YouTube and other sites with media listings. Results are read 5 at a time to avoid overwhelming the user.

| Say | What it does |
|-----|--------------|
| "List videos" / "Show results" | Reads first 5 video titles (with channel and duration) |
| "Next" / "More" | Reads the next 5 |
| "Play number 1" | Clicks and opens video #1 |
| "Play the first video" | Same (supports first through tenth) |
| "Play video 3" / "Open number 5" | Pick any by number |

---

## YouTube Commands

When on `youtube.com`, these commands are available via keyboard simulation and URL navigation:

| Say | What it does |
|-----|--------------|
| "Play" / "Pause" | Toggle video playback |
| "Next video" / "Previous video" | Skip between videos |
| "Mute" / "Unmute" | Toggle audio |
| "Fullscreen" | Toggle fullscreen |
| "Captions" / "Subtitles" | Toggle closed captions |
| "Rewind" / "Fast forward" | Skip 10 seconds back/forward |
| "Speed up video" / "Slow down video" | Change playback speed |
| "Trending" | Open YouTube Trending |
| "Subscriptions" | Open Subscriptions feed |
| "Watch history" | Open History |
| "Liked videos" | Open Liked Videos playlist |
| "Watch later" | Open Watch Later playlist |
| "Shorts" | Open YouTube Shorts |
| "YouTube home" | Go to YouTube home page |

---

## Page Interaction Commands

Interact with page elements using DOM detection — works on most sites without any AI cost:

| Say | What it does |
|-----|--------------|
| "Type hello" | Finds the best input field and types "hello" |
| "Search for cats" | Finds search input, types, and submits (or uses URL search on known sites) |
| "Click Sign in" | Finds a button/link by visible text and clicks it |
| "Press enter" | Submits the currently focused element |
| "Focus search" | Focuses the search bar |
| "Clear input" | Clears the current input field |
| "What fields are on this page" | Lists all visible form fields |

---

## Conversation Memory

The extension learns about you over time and sends context to Gemini so it remembers your conversations:

- **Profile facts** — Automatically extracted from things you say ("My name is …", "I like …", "I work at …", "Remember that …"). Stored locally, capped at 50 facts.
- **Session history** — Last 100 Q&A turns are stored with timestamps. Auto-cleaned after 7 days.
- **Gemini context** — Every Gemini API call includes your profile facts + last 8 conversation turns in the system prompt.
- **Memory commands**:

| Say | What it does |
|-----|--------------|
| "What do you know about me" | Reads back all learned profile facts |
| "Show saved pages" | Lists pages you saved with "remember this page" |
| "Show history" | Summarizes recent conversation turns |
| "Forget about me" | Clears profile facts only |
| "Forget everything" | Clears all personal data and history |

---

## Enabling Chrome Built-in AI (Gemini Nano)

Optional. If enabled, it is used **before** the Gemini API (no key needed for those requests). Requires ~22 GB free disk and 4+ GB VRAM (or 16 GB RAM on Chrome 140+ with CPU path).

1. `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
2. `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
3. Relaunch Chrome
4. `chrome://components` → **Optimization Guide On Device Model** → **Check for update**

---

## Voice commands (no AI)

Examples the assistant handles without any AI or API key:

| Say | Result |
|-----|--------|
| "How many tabs are open" | Speaks the count |
| "List my tabs" | Speaks titles/URLs |
| "What page am I on" | Speaks current tab title and URL |
| "Read this page" | Reads main content via TTS |
| "Scroll down" / "Scroll up" | Scrolls the page |
| "Go back" / "Go forward" | Browser history |
| "Reload" / "Refresh" | Reloads the page |
| "List the links" / "What's the title" | Reads links or title |
| "Summarize" | Speaks extracted page text |
| "What time is it" / "What's the date" | Time and date |
| "Remember my name is …" / "What's my name" | Saves/recalls name in storage |
| "Open new tab" / "Go to youtube.com" | Opens URL or new tab |
| "Close this tab" | Closes active tab |
| "Go to tab 2" / "Next tab" / "Previous tab" | Tab navigation |
| "Close all other tabs" | Keep only the active tab |
| "Find tab with YouTube" | Switch to a tab by keyword |
| "Pause reading" / "Resume" / "Stop reading" | TTS playback control |
| "Read slower" / "Read faster" | Adjust TTS speed |
| "Toggle high contrast" | Accessibility: high contrast mode |
| "Increase text size" | Accessibility: larger text |
| "Show focus highlight" | Accessibility: focus outlines |

More phrasing is supported (e.g. "What site is this", "Which page am I on"). Open **Commands** in the side panel for a full list.

---

## Tech stack

- **Extension**: Manifest V3, side panel, background service worker (module), content script
- **Permissions**: `tabs`, `activeTab`, `scripting`, `storage`, `sidePanel`, `tts`, `identity`, host permissions for `generativelanguage.googleapis.com` and `googleapis.com`
- **Voice**: Web Speech API (SpeechRecognition in side panel; mic permission when you start listening)
- **AI**: Chrome Prompt API (optional), Gemini 2.5 Flash via REST API
- **Google auth/data**: `chrome.identity` OAuth2 flow for Gmail (and future Drive/Docs/Calendar)
- **Storage**: `chrome.storage.local` for API keys, user profile, session history, preferences, and cached Gmail state

---

## Roadmap

- [x] MV3 side panel, voice in/out, keyword + Chrome API commands
- [x] Gemini API with multi-key management and active key
- [x] Chrome Built-in AI as optional first-tier AI
- [x] Glassmorphism UI, settings as full-screen view, mic pulse animation
- [x] Site-aware URL search (YouTube, Google, Amazon, Reddit, etc.)
- [x] YouTube player controls and navigation commands
- [x] Page interaction (type, click, search, focus, clear)
- [x] Conversation memory with profile extraction and session context
- [x] Tab productivity (go to tab N, next/previous, close others, find by keyword)
- [x] Read controls (pause, resume, stop, speed)
- [x] Accessibility helpers (high contrast, text size, focus highlight)
- [ ] User settings: TTS rate/voice, recognition language
- [ ] Summarization API (when available) for "Summarize this page"
- [ ] Vision: screenshot + Gemini vision for "What's on screen?"
- [ ] Gmail / Google Docs–specific commands — *Gmail voice commands are implemented (see COMMAND_REFERENCE.md); Google Docs commands are not yet implemented*
- [ ] More site-specific commands (Spotify, Netflix, etc.)

---

## License & repo

Part of the **Chrome extension for the blind** project. Repository: [Chrome-extension-VI](https://github.com/shahtab123/Chrome-extension-VI).

**Command reference:** [COMMAND_REFERENCE.md](COMMAND_REFERENCE.md)
