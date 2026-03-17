// content/domReader.js
// DOM extraction utilities for the content script.
// These functions run inside the page context — no chrome.* APIs here.

/**
 * Extracts readable text from the page using semantic HTML and ARIA landmarks.
 * @returns {string}
 */
export function readPageContent() {
  const root =
    document.querySelector('main, article, [role="main"]') || document.body;

  const headings = [...root.querySelectorAll('h1, h2, h3')]
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  const paragraphs = [...root.querySelectorAll('p')]
    .map((el) => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 6);

  const parts = [];
  if (headings.length)   parts.push(`Headings: ${headings.join('. ')}.`);
  if (paragraphs.length) parts.push(paragraphs.join(' '));

  return parts.join(' ') || document.title || 'No readable content found.';
}

/**
 * Returns an array of { text, href } for all visible links.
 * @returns {{ text: string, href: string }[]}
 */
export function getLinks() {
  return [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: a.textContent.trim(), href: a.href }))
    .filter((l) => l.text.length > 0);
}

/**
 * Returns all interactive / focusable elements on the page.
 * @returns {Element[]}
 */
export function getFocusableElements() {
  return [
    ...document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), ' +
      '[tabindex]:not([tabindex="-1"])'
    ),
  ];
}

/**
 * Extracts structured content: headings, lists, tables, and form fields.
 * @returns {{ headings: string[], lists: string[][], tables: string[][][], fields: string[] }}
 */
export function getStructuredContent() {
  return {
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .map((el) => `${el.tagName}: ${el.textContent.trim()}`)
      .filter(Boolean),

    lists: [...document.querySelectorAll('ul, ol')].map((list) =>
      [...list.querySelectorAll('li')].map((li) => li.textContent.trim())
    ),

    tables: [...document.querySelectorAll('table')].map((table) =>
      [...table.querySelectorAll('tr')].map((row) =>
        [...row.querySelectorAll('th, td')].map((cell) => cell.textContent.trim())
      )
    ),

    fields: [...document.querySelectorAll('input, select, textarea')].map((el) => {
      const label =
        document.querySelector(`label[for="${el.id}"]`)?.textContent.trim() ??
        el.getAttribute('aria-label') ??
        el.getAttribute('placeholder') ??
        el.name ??
        el.type;
      return label;
    }).filter(Boolean),
  };
}
