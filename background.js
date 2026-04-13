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
        voiceName: message.voiceName || undefined,
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

    case 'PAUSE_SPEAKING':
      chrome.tts.pause();
      sendResponse({ ok: true });
      break;

    case 'RESUME_SPEAKING':
      chrome.tts.resume();
      sendResponse({ ok: true });
      break;

    case 'OPEN_TAB':
      openTab(message.url).then((tab) => sendResponse({ ok: true, tab }));
      return true; // async

    case 'NAVIGATE_TAB':
      // Navigate the current active tab to a URL (don't open a new tab)
      getActiveTab().then(async (tab) => {
        if (!tab) {
          // No active tab — fall back to opening a new one
          const newTab = await openTab(message.url);
          sendResponse({ ok: true, tab: newTab });
          return;
        }
        // chrome:// pages can't be navigated via update on some builds — use create as fallback
        try {
          await chrome.tabs.update(tab.id, { url: message.url });
          sendResponse({ ok: true });
        } catch {
          const newTab = await openTab(message.url);
          sendResponse({ ok: true, tab: newTab });
        }
      });
      return true; // async

    case 'SEND_TO_CONTENT':
      // Forward a payload from the side panel to the active page's content script
      getActiveTab().then((tab) => {
        if (!tab) { sendResponse({ error: 'No active tab' }); return; }

        chrome.tabs.sendMessage(tab.id, message.payload, async (response) => {
          // If content script is unavailable (e.g. chrome:// pages), fallback here.
          if (chrome.runtime.lastError) {
            const action = message.payload?.type;
            try {
              switch (action) {
                case 'GO_BACK':
                  await chrome.tabs.goBack(tab.id);
                  sendResponse({ ok: true, fallback: true });
                  return;

                case 'GO_FORWARD':
                  await chrome.tabs.goForward(tab.id);
                  sendResponse({ ok: true, fallback: true });
                  return;

                case 'RELOAD':
                  await chrome.tabs.reload(tab.id);
                  sendResponse({ ok: true, fallback: true });
                  return;

                case 'SCROLL': {
                  const direction = message.payload?.direction === 'up' ? -400 : 400;
                  await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (dy) => window.scrollBy({ top: dy, behavior: 'smooth' }),
                    args: [direction],
                  });
                  sendResponse({ ok: true, fallback: true });
                  return;
                }

                case 'YT_CONTROL': {
                  const ytAction = message.payload?.action;
                  const ytDelta = message.payload?.delta ?? 0;
                  const ytPercent = message.payload?.percent ?? 0;
                  const [result] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (action, delta, percent) => {
                      const v = document.querySelector('video');
                      if (!v) return { error: 'No video found on this page.' };
                      switch (action) {
                        case 'play':       v.play(); return { ok: true };
                        case 'pause':      v.pause(); return { ok: true };
                        case 'toggle':     v.paused ? v.play() : v.pause(); return { ok: true, playing: !v.paused };
                        case 'seek_start': v.currentTime = 0; v.play(); return { ok: true };
                        case 'seek':       v.currentTime = Math.max(0, v.currentTime + delta); return { ok: true };
                        case 'seek_pct':   v.currentTime = (v.duration || 0) * (percent / 100); return { ok: true };
                        case 'mute':       v.muted = !v.muted; return { ok: true, muted: v.muted };
                        case 'volume':     v.volume = Math.min(1, Math.max(0, v.volume + delta)); return { ok: true, volume: Math.round(v.volume * 100) };
                        case 'speed':      v.playbackRate = Math.min(4, Math.max(0.25, v.playbackRate + delta)); return { ok: true, speed: v.playbackRate };
                        case 'status':     return { ok: true, paused: v.paused, time: Math.round(v.currentTime), duration: Math.round(v.duration || 0), volume: Math.round(v.volume * 100), muted: v.muted, speed: v.playbackRate };
                        default: return { error: `Unknown action: ${action}` };
                      }
                    },
                    args: [ytAction, ytDelta, ytPercent],
                  });
                  sendResponse(result?.result ?? { error: 'Script execution failed.' });
                  return;
                }

                case 'TYPE_INTO_INPUT':
                case 'SEARCH_PAGE':
                case 'FOCUS_SEARCH':
                case 'CLEAR_INPUT':
                case 'CLICK_BY_TEXT':
                case 'PRESS_ENTER':
                case 'GET_FORM_FIELDS':
                  sendResponse({
                    error: 'This page does not allow interaction (restricted page).',
                    fallback: true,
                  });
                  return;

                default:
                  sendResponse({
                    error: `Action ${action} unavailable on this page.`,
                    fallback: true,
                  });
              }
            } catch (err) {
              sendResponse({
                error: err?.message ?? 'Fallback action failed.',
                fallback: true,
              });
            }
            return;
          }

          // Content script path succeeded
          sendResponse(response ?? { ok: true });
        });
      });
      return true; // async

    case 'CREATE_ALARM':
      (async () => {
        await chrome.alarms.create(message.name, { delayInMinutes: message.delayMinutes });
        const { alarmMeta = {} } = await chrome.storage.local.get('alarmMeta');
        alarmMeta[message.name] = { label: message.label, delayMinutes: message.delayMinutes };
        await chrome.storage.local.set({ alarmMeta });
        sendResponse({ ok: true });
      })();
      break;

    case 'CANCEL_ALL_ALARMS':
      (async () => {
        const alarms = await chrome.alarms.getAll();
        for (const a of alarms) await chrome.alarms.clear(a.name);
        await chrome.storage.local.set({ alarmMeta: {} });
        sendResponse({ ok: true, count: alarms.length });
      })();
      break;

    case 'LIST_ALARMS':
      (async () => {
        const alarms = await chrome.alarms.getAll();
        const { alarmMeta = {} } = await chrome.storage.local.get('alarmMeta');
        sendResponse({ ok: true, alarms, meta: alarmMeta });
      })();
      break;

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }

  return true;
});

// ─── Timer / alarm fire ────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const { alarmMeta = {} } = await chrome.storage.local.get('alarmMeta');
  const label = alarmMeta[alarm.name]?.label || 'timer';
  chrome.tts.speak(`Time's up! Your ${label} is done.`, {
    rate: 1.0, pitch: 1.1, volume: 1.0,
  });
  // Clean up
  delete alarmMeta[alarm.name];
  await chrome.storage.local.set({ alarmMeta });
});
