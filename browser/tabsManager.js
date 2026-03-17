// browser/tabsManager.js
// Utilities for querying and controlling browser tabs.
// Imported by background.js (service worker context).

/**
 * Returns the currently active tab in the focused window, or null.
 * @returns {Promise<chrome.tabs.Tab | null>}
 */
export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/**
 * Opens a new tab and returns it.
 * @param {string} url
 */
export async function openTab(url) {
  return chrome.tabs.create({ url });
}

/**
 * Closes the given tab (or the active tab if no id provided).
 * @param {number} [tabId]
 */
export async function closeTab(tabId) {
  if (tabId !== undefined) {
    return chrome.tabs.remove(tabId);
  }
  const tab = await getActiveTab();
  if (tab) return chrome.tabs.remove(tab.id);
}

/**
 * Returns all tabs in the current window.
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function getAllTabs() {
  return chrome.tabs.query({ currentWindow: true });
}

/**
 * Switches focus to the given tab.
 * @param {number} tabId
 */
export async function switchToTab(tabId) {
  return chrome.tabs.update(tabId, { active: true });
}

/**
 * Finds the first tab whose title or URL contains the given query string.
 * @param {string} query
 * @returns {Promise<chrome.tabs.Tab | null>}
 */
export async function findTab(query) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const lower = query.toLowerCase();
  return (
    tabs.find(
      (t) =>
        t.title?.toLowerCase().includes(lower) ||
        t.url?.toLowerCase().includes(lower)
    ) ?? null
  );
}

/**
 * Takes a screenshot of the current visible tab (used for AI vision tasks).
 * @returns {Promise<string>} data URL (image/png)
 */
export async function captureTab() {
  return chrome.tabs.captureVisibleTab(null, { format: 'png' });
}
