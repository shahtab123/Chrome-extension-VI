// browser/drive.js
// Google Drive + Docs API module.
// Auth is shared with Gmail — same chrome.identity token covers all Google APIs
// as long as the right scopes are declared in manifest.json oauth2.scopes.

import { getAuthToken, removeCachedToken } from './gmail.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DOCS_API  = 'https://docs.googleapis.com/v1';

// ─── Shared fetch ─────────────────────────────────────────────────────────────

async function driveFetch(url, options = {}) {
  let token = await getAuthToken();
  const fullUrl = url.startsWith('http') ? url : `${DRIVE_API}${url}`;

  const doReq = (t) =>
    fetch(fullUrl, {
      ...options,
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

  let res = await doReq(token);

  if (res.status === 401) {
    await removeCachedToken(token);
    token = await getAuthToken();
    res = await doReq(token);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Drive API error: HTTP ${res.status}`);
  }
  return res.json();
}

async function docsFetch(path, options = {}) {
  return driveFetch(`${DOCS_API}${path}`, options);
}

// ─── List files ───────────────────────────────────────────────────────────────

export async function listDocs(maxResults = 5) {
  const q = `mimeType='application/vnd.google-apps.document' and trashed=false`;
  const data = await driveFetch(
    `/files?q=${encodeURIComponent(q)}&pageSize=${maxResults}&orderBy=modifiedTime+desc&fields=files(id,name,modifiedTime,webViewLink)`
  );
  return data.files || [];
}

export async function listRecentFiles(maxResults = 5) {
  const q = `trashed=false and mimeType!='application/vnd.google-apps.folder'`;
  const data = await driveFetch(
    `/files?q=${encodeURIComponent(q)}&pageSize=${maxResults}&orderBy=modifiedTime+desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)`
  );
  return data.files || [];
}

// ─── Search ───────────────────────────────────────────────────────────────────

/** Search Docs (and optionally Sheets / Slides) by name */
export async function searchDocs(query, maxResults = 5) {
  const safe = query.replace(/'/g, "\\'");
  const q =
    `(mimeType='application/vnd.google-apps.document' or ` +
    ` mimeType='application/vnd.google-apps.spreadsheet' or ` +
    ` mimeType='application/vnd.google-apps.presentation') ` +
    `and name contains '${safe}' and trashed=false`;
  const data = await driveFetch(
    `/files?q=${encodeURIComponent(q)}&pageSize=${maxResults}&orderBy=modifiedTime+desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)`
  );
  return data.files || [];
}

/** Search any file in Drive by name */
export async function searchAllFiles(query, maxResults = 5) {
  const safe = query.replace(/'/g, "\\'");
  const q = `name contains '${safe}' and trashed=false`;
  const data = await driveFetch(
    `/files?q=${encodeURIComponent(q)}&pageSize=${maxResults}&orderBy=modifiedTime+desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)`
  );
  return data.files || [];
}

// ─── Read doc content ─────────────────────────────────────────────────────────

/** Returns plain text from a Google Doc */
export async function getDocContent(docId) {
  const doc = await docsFetch(`/documents/${docId}`);
  return { title: doc.title || '', text: extractDocText(doc) };
}

function extractDocText(doc) {
  const blocks = doc.body?.content || [];
  let text = '';
  for (const block of blocks) {
    if (block.paragraph) {
      for (const el of block.paragraph.elements || []) {
        if (el.textRun?.content) text += el.textRun.content;
      }
    }
    if (block.table) {
      for (const row of block.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          for (const cb of cell.content || []) {
            if (cb.paragraph) {
              for (const el of cb.paragraph.elements || []) {
                if (el.textRun?.content) text += el.textRun.content + ' ';
              }
            }
          }
        }
        text += '\n';
      }
    }
  }
  return text.trim();
}

// ─── Create doc ───────────────────────────────────────────────────────────────

export async function createDoc(title) {
  return docsFetch('/documents', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

// ─── Write / Edit doc content (Docs API batchUpdate) ─────────────────────────

/**
 * Replaces ALL content of a Google Doc with new text.
 * Requires documents scope (not readonly).
 */
export async function writeToDoc(docId, text) {
  const doc = await docsFetch(`/documents/${docId}`);
  const requests = [];

  // Find the current body end index so we can delete existing content
  const bodyContent = doc.body?.content || [];
  const lastBlock   = bodyContent[bodyContent.length - 1];
  const endIndex    = (lastBlock?.endIndex ?? 2) - 1;

  // Only delete if there is existing content (endIndex > 1)
  if (endIndex > 1) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex },
      },
    });
  }

  // Insert new content at the beginning of the body
  requests.push({
    insertText: {
      location: { index: 1 },
      text,
    },
  });

  return docsFetch(`/documents/${docId}:batchUpdate`, {
    method: 'POST',
    body:   JSON.stringify({ requests }),
  });
}

/**
 * Appends text to the end of an existing Google Doc.
 */
export async function appendToDoc(docId, text) {
  const doc = await docsFetch(`/documents/${docId}`);
  const bodyContent = doc.body?.content || [];
  const lastBlock   = bodyContent[bodyContent.length - 1];
  // Insert just before the final newline (endIndex - 1)
  const insertIndex = (lastBlock?.endIndex ?? 2) - 1;

  return docsFetch(`/documents/${docId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        insertText: {
          location: { index: insertIndex },
          text: `\n\n${text}`,
        },
      }],
    }),
  });
}

/**
 * Creates a new Google Doc and immediately fills it with content.
 * Returns { docId, title, url }.
 */
export async function createDocWithContent(title, content) {
  const doc = await createDoc(title);
  const docId = doc.documentId;
  await writeToDoc(docId, content);
  return { docId, title: doc.title, url: getDocUrl(docId) };
}

// ─── Export doc as PDF base64 (for Gmail attachment) ─────────────────────────

export async function exportDocBase64(docId) {
  const token = await getAuthToken();
  const res = await fetch(
    `${DRIVE_API}/files/${docId}/export?mimeType=application/pdf`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Could not export doc as PDF: HTTP ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getDocUrl(docId)   { return `https://docs.google.com/document/d/${docId}/edit`; }
export function getSheetUrl(id)    { return `https://docs.google.com/spreadsheets/d/${id}/edit`; }
export function getSlidesUrl(id)   { return `https://docs.google.com/presentation/d/${id}/edit`; }

export function mimeToType(mime) {
  const map = {
    'application/vnd.google-apps.document':     'Google Doc',
    'application/vnd.google-apps.spreadsheet':  'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder':       'Folder',
    'application/pdf':                          'PDF',
  };
  return map[mime] || 'File';
}

export function fileUrl(file) {
  if (file.webViewLink) return file.webViewLink;
  const m = file.mimeType || '';
  if (m.includes('document'))     return getDocUrl(file.id);
  if (m.includes('spreadsheet'))  return getSheetUrl(file.id);
  if (m.includes('presentation')) return getSlidesUrl(file.id);
  return `https://drive.google.com/file/d/${file.id}/view`;
}

/** Extract Google Doc ID from a URL like https://docs.google.com/document/d/<ID>/edit */
export function docIdFromUrl(url = '') {
  const m = url.match(/\/document\/d\/([\w-]+)/);
  return m ? m[1] : null;
}
