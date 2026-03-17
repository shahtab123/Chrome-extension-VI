// background.js — Service Worker (MV3)
// Handles: side panel open, keyboard shortcut relay, TTS via chrome.tts, message routing

import { getActiveTab, openTab } from './browser/tabsManager.js';

// ─── Side panel ───────────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Keyboard shortcut ────────────────────────────────────────────────────────
// Ctrl+Shift+P (defined in manifest) — relay toggle to side panel
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-listening') {
    chrome.runtime.sendMessage({ type: 'TOGGLE_LISTENING' }).catch(() => {
      // Side panel may not be open yet — ignore silently
    });
  }
});

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'SPEAK':
      chrome.tts.speak(message.text, {
        rate:   message.rate   ?? 1.0,
        pitch:  message.pitch  ?? 1.0,
        volume: message.volume ?? 1.0,
        onEvent(event) {
          if (event.type === 'end' || event.type === 'error') {
            chrome.runtime.sendMessage({ type: 'TTS_DONE' }).catch(() => {});
          }
        },
      });
      sendResponse({ ok: true });
      break;

    case 'STOP_SPEAKING':
      chrome.tts.stop();
      sendResponse({ ok: true });
      break;

    case 'OPEN_TAB':
      openTab(message.url).then((tab) => sendResponse({ ok: true, tab }));
      return true; // async

    case 'SEND_TO_CONTENT':
      // Forward a payload from the side panel to the active page's content script
      getActiveTab().then((tab) => {
        if (!tab) { sendResponse({ error: 'No active tab' }); return; }
        chrome.tabs.sendMessage(tab.id, message.payload, sendResponse);
      });
      return true; // async

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }

  return true;
});
