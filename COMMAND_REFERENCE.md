# Voice command reference

This document lists what you can say to **Voice AI Assistant for the Blind** and what the extension does. Phrasing is flexible: many synonyms and natural variations are supported. Commands are handled in **priority order** in code (Chrome API first, then page actions, then built-in AI, then Gemini API).

**Requirements (by feature):**

| Feature | Needs |
|--------|--------|
| Most browser / page commands | Nothing extra |
| Open-ended AI answers | Gemini API key in Settings, and/or Chrome Built-in AI |
| Gmail read/send | Google OAuth configured in `manifest.json` + user signs in once |
| AI-drafted email replies / new mail | Gmail OAuth + **Gemini API key** (otherwise text is sent as you spoke it) |

---

## 1. Listening and shortcut

| You say / do | What happens |
|--------------|--------------|
| Tap **Start listening** / **Stop** | Starts or stops Web Speech recognition in the side panel |
| **Alt+Shift+1** (default) | Toggles listening (change at `chrome://extensions/shortcuts`) |

---

## 2. Tabs and windows

| Example phrases | What happens |
|-----------------|--------------|
| How many tabs / tabs open / number of tabs | Speaks count of tabs in the current window |
| List tabs / list my tabs / show tabs / what tabs | Speaks each tab number, title, URL |
| What page am I on / what site / current tab / where am I | Speaks active tab title and URL |
| Open new tab / new blank tab | Opens `chrome://newtab/` |
| Go to `youtube.com` / open / navigate / visit + URL | Navigates **current** tab to that URL (https added if missing) |
| Close tab / close this tab | Closes the active tab |
| Go to tab 2 / switch to tab 3 | Activates tab by 1-based index |
| Next tab / previous tab | Switches tab forward/back in current window |
| Close all other tabs / close other tabs | Keeps only the active tab |
| Find tab with YouTube / go to tab named … | Switches to first tab whose title or URL contains the phrase |

---

## 3. Tab productivity (same as §2 detail)

Same commands as in the side panel **Tabs** and **Tab Productivity** groups.

---

## 4. Read controls (TTS)

These control **assistant speech** (`chrome.tts`), not the YouTube HTML5 player.

| Example phrases | What happens |
|-----------------|--------------|
| Pause reading / pause voice / pause speaking / pause | Pauses TTS |
| Resume reading / continue reading / resume | Resumes TTS |
| Stop reading / stop voice / stop speaking | Stops TTS |
| Read slower / speak slower | Lowers stored `ttsRate` |
| Read faster / speak faster | Raises stored `ttsRate` |
| Repeat that / read last response / say that again | Re-speaks last assistant response from storage |

---

## 5. Page reading and navigation (content script)

| Example phrases | What happens |
|-----------------|--------------|
| Read this page / read the page / read aloud / what's on this page | Extracts main text and speaks via TTS |
| Summarize / summary / overview | Sends summarize request to content script |
| List links / show links / what links | Lists links on the page |
| What's the title / page title | Speaks document title |
| Scroll down / scroll up / page down / page up | Scrolls the page |
| Go back / previous page | Browser back |
| Go forward / next page | Browser forward |
| Reload / refresh / reload page | Reloads tab |

---

## 6. Accessibility (page)

| Example phrases | What happens |
|-----------------|--------------|
| Toggle high contrast | Toggles high-contrast class on page |
| Increase text size / larger text | Increases text size on page |
| Show focus highlight / toggle focus highlight | Toggles focus outlines |

---

## 7. Time and identity

| Example phrases | What happens |
|-----------------|--------------|
| What time / current time | Speaks local time |
| What date / what day / today's date | Speaks local date |
| Who are you / what are you / your name | Fixed assistant identity (not “I am Gemini…”) |

---

## 8. Memory and profile

| Example phrases | What happens |
|-----------------|--------------|
| Remember my name is … / call me … | Saves name and a profile fact |
| What's my name | Recalls saved name |
| What do you know about me / my profile | Reads profile facts |
| Remember this page / save this page | Saves current tab URL/title to saved pages |
| Show saved pages / my saved pages | Lists saved pages |
| What did I ask before / last question | Last question from session history |
| Show history / conversation history | Summarizes recent turns |
| Forget everything / clear memory | Clears name, profile, history, saved pages, etc. |
| Forget about me / clear my profile | Clears profile only |

---

## 9. Site-aware search and typing

On **known sites** (YouTube, Google, Amazon, etc.), **search** and **type** often navigate via URL instead of DOM.

| Example phrases | What happens |
|-----------------|--------------|
| Search for cats | On a known site: site search URL; else Google search |
| Search YouTube for music | Opens YouTube results for query |
| Type hello | On known site may trigger search URL; else types into focused/best input |

See README **Site-Aware URL Search** for the site list.

---

## 10. Page interaction (DOM)

| Example phrases | What happens |
|-----------------|--------------|
| Type … / write … / input … | Types into best visible input |
| Click Sign in / click … | Clicks element by visible text |
| Press enter / submit | Submits focused control |
| Focus search / go to search | Focuses search-like field |
| Clear input / clear search | Clears focused input |
| What fields / form fields / list fields | Lists visible form fields |

---

## 11. Video browsing (paginated)

Works on pages where the content script finds media items (e.g. YouTube results).

| Example phrases | What happens |
|-----------------|--------------|
| List videos / show videos / list results / read titles … | Lists first **5** items; stores list for “next” |
| Next / more / show more (in list context) | Next 5 from cached list |
| Play 1 / play number 2 / play the first video / play item one … | Opens/plays item by index |

---

## 12. YouTube (on youtube.com)

**Playback** uses the HTML5 `<video>` API where possible; some UI actions use simulated keys.

| Area | Example phrases | What happens |
|------|-----------------|--------------|
| Start | Play / start / resume / unpause / can you play … | `video.play()` |
| Pause | Pause / stop video | `video.pause()` |
| Start over | From beginning / start over / restart video … | Seeks to 0, plays |
| Volume | Volume up/down, louder/quieter | Adjusts `video.volume` |
| Mute | Mute / unmute | Toggles `muted` |
| Speed | Speed up video / slow down video | Changes `playbackRate` |
| Seek | Rewind / fast forward (5s, 10s), jump to N% | Seeks `currentTime` |
| Status | Video status / how long is this video … | Speaks time, duration, volume, speed |
| UI | Fullscreen, captions, miniplayer, YouTube search (/) | Keyboard simulation |
| Feed | Trending, subscriptions, history, liked, watch later, shorts, home | Navigates by URL |

---

## 13. Gmail (OAuth)

**Sign-in:** First email command opens Google consent if needed; token is cached. **Connect Gmail** in Settings does the same.

### 13.1 Open and counts

| Example phrases | What happens |
|-----------------|--------------|
| Open Gmail / go to Gmail / open my email / open inbox / take me to email … | If there are unread messages: unread count + first 5 + list; if none: says inbox clear |
| How many unread / any new email / email count … | Speaks **estimated** unread count (Gmail API `resultSizeEstimate` on a 1-message probe) |
| Check my email / read my inbox / show inbox / my emails / list email … | Lists 5 messages (unread-focused phrasing uses unread query) |
| More emails / next batch / continue reading email / load more … | Attempts next page of list (see note below) |
| Gmail status / is Gmail connected | Connected or not |

### 13.2 Reading and navigation in a list

| Example phrases | What happens |
|-----------------|--------------|
| Read email 1 / open email 2 / read the first email / email one … | Fetches full message, marks read, sets “current” email for actions |
| Next email / read next / skip to next … | Opens next in cached list |
| Previous email / read previous / last email … | Opens previous in cached list |
| Back to inbox / email list / go back to mail … | Re-reads cached list; clears current message pointer |
| Who sent this / who is this from | Speaks From + Subject for current email |

### 13.3 Search and folders

| Example phrases | What happens |
|-----------------|--------------|
| Search email for … / find email … / look for … in gmail … | Gmail search query, first 5 results |
| Show starred / starred email … | `is:starred` |
| Show important / important email … | `is:important` |
| Show sent / sent email … | `in:sent` |

### 13.4 Reply and compose

| Example phrases | What happens |
|-----------------|--------------|
| Reply … / respond … / write back … | If **Gemini key** set: drafts reply from original email + your intent, sends it, reads draft aloud. Else: sends your words as-is |
| Send email to `user@x.com` saying … | If **Gemini key**: drafts subject + body from intent. Else: default subject + your text as body |

You can give rich instructions, e.g. “reply with a detailed apology addressing their concerns”.

### 13.5 Actions on current email

Requires a **current** email (after “read email N” or “next email”).

| Example phrases | What happens |
|-----------------|--------------|
| Archive email / move to archive … | Removes INBOX label |
| Delete email / trash … | Moves to trash |
| Mark important / flag this / save for later (as important) … | Adds IMPORTANT |
| Remove important / unflag … | Removes IMPORTANT |
| Star this email / add star … | Adds STARRED |
| Unstar / remove star … | Removes STARRED |
| Mark as read / mark read … | Removes UNREAD |
| Mark as unread / keep unread … | Adds UNREAD |

### 13.6 Connect / disconnect

| Example phrases | What happens |
|-----------------|--------------|
| Connect Gmail / sign in to Gmail … | Interactive OAuth |
| Disconnect Gmail / sign out of Gmail … | Clears cached token |

---

## 14. Open-ended AI (Gemini / built-in)

Anything that does not match a structured command may go to:

1. Chrome Built-in AI (if available), or  
2. Gemini API (if a key is active).

Tone and identity are controlled in `ai/geminiApi.js` and `ai/promptHandler.js` (assistant does not claim to be “Google’s LLM”).

---

## 15. Limitations and notes

- **Gmail “more emails” pagination** depends on list query and caching; if the next batch is empty, say **check my email** again to refresh.
- **Unread count** is an estimate from Gmail’s API for the listing endpoint, not a guaranteed exact integer for huge mailboxes.
- **Speech recognition** depends on Chrome and network; errors are mapped to clearer messages and spoken aloud.
- **Restricted Chrome pages** (e.g. `chrome://`, Web Store) may block content scripts; some actions fall back via `chrome.scripting` in `background.js`.

---

## 16. Files that define behavior

| Area | File |
|------|------|
| Command routing | `ai/promptHandler.js` |
| Gmail API | `browser/gmail.js` |
| Gemini + email drafting | `ai/geminiApi.js` |
| Memory | `ai/memory.js` |
| Side panel UI | `sidepanel.js`, `sidepanel.html` |
| Content script | `content.js` |
| Background | `background.js` |

For install and Google Cloud setup, see **README.md** → *Getting started for new users* and *Gmail setup checklist*.
