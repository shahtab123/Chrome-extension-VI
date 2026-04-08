// browser/gmail.js
// Gmail API module — auth via chrome.identity, REST calls for read/send/reply.
// User clicks "Allow" once; chrome.identity handles login + token refresh.

const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';

// ─── Auth ─────────────────────────────────────────────────────────────────────

// interactive defaults to true so any email command auto-prompts sign-in on first use.
// Chrome caches the token after the first approval — users never need to sign in again.
export function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error('No auth token received. Please sign in to Google.'));
      } else {
        resolve(token);
      }
    });
  });
}

export function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

async function gmailFetch(path, options = {}) {
  let token = await getAuthToken();
  let res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Token expired — remove and retry once
  if (res.status === 401) {
    await removeCachedToken(token);
    token = await getAuthToken();
    res = await fetch(`${GMAIL_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gmail API error: HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Check if Gmail is connected ──────────────────────────────────────────────

export async function isGmailConnected() {
  try {
    await getAuthToken(false);
    return true;
  } catch {
    return false;
  }
}

// ─── List messages ────────────────────────────────────────────────────────────

export async function listMessages(maxResults = 5, query = 'in:inbox') {
  const data = await gmailFetch(`/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`);
  if (!data.messages?.length) return [];

  const details = await Promise.all(
    data.messages.map((m) => getMessage(m.id))
  );
  return details;
}

export async function listUnread(maxResults = 5) {
  return listMessages(maxResults, 'in:inbox is:unread');
}

// ─── Get single message ──────────────────────────────────────────────────────

export async function getMessage(id) {
  const data = await gmailFetch(`/messages/${id}?format=full`);
  return parseMessage(data);
}

function parseMessage(msg) {
  const headers = msg.payload?.headers || [];
  const get = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  let body = '';
  if (msg.payload?.body?.data) {
    body = decodeBase64(msg.payload.body.data);
  } else if (msg.payload?.parts) {
    const textPart = msg.payload.parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      body = decodeBase64(textPart.body.data);
    } else {
      const htmlPart = msg.payload.parts.find((p) => p.mimeType === 'text/html');
      if (htmlPart?.body?.data) {
        body = stripHtml(decodeBase64(htmlPart.body.data));
      }
    }
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet || '',
    from: get('From'),
    to: get('To'),
    subject: get('Subject'),
    date: get('Date'),
    body: body.trim().slice(0, 2000),
    labels: msg.labelIds || [],
    isUnread: (msg.labelIds || []).includes('UNREAD'),
  };
}

// ─── Send / Reply ─────────────────────────────────────────────────────────────

export async function sendEmail({ to, subject, body }) {
  const raw = buildRawEmail({ to, subject, body });
  return gmailFetch('/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  });
}

export async function replyToMessage(messageId, body) {
  const original = await getMessage(messageId);
  const to = original.from;
  const subject = original.subject.startsWith('Re:')
    ? original.subject
    : `Re: ${original.subject}`;

  const raw = buildRawEmail({
    to,
    subject,
    body,
    inReplyTo: messageId,
    threadId: original.threadId,
  });

  return gmailFetch('/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw, threadId: original.threadId }),
  });
}

// ─── Modify labels (mark read/unread, archive, trash) ─────────────────────────

export async function markAsRead(messageId) {
  return gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}

export async function archiveMessage(messageId) {
  return gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
  });
}

export async function trashMessage(messageId) {
  return gmailFetch(`/messages/${messageId}/trash`, { method: 'POST' });
}

export async function markAsUnread(messageId) {
  return gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: ['UNREAD'] }),
  });
}

export async function starMessage(messageId) {
  return gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: ['STARRED'] }),
  });
}

export async function unstarMessage(messageId) {
  return gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['STARRED'] }),
  });
}

export async function markImportant(messageId) {
  return gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: ['IMPORTANT'] }),
  });
}

export async function markNotImportant(messageId) {
  return gmailFetch(`/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['IMPORTANT'] }),
  });
}

export async function getUnreadCount() {
  const data = await gmailFetch('/messages?maxResults=1&q=in:inbox is:unread');
  return data.resultSizeEstimate ?? 0;
}

// List message IDs only (lightweight, for counting / pagination)
export async function listMessageIds(maxResults = 10, query = 'in:inbox', pageToken = '') {
  let path = `/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`;
  if (pageToken) path += `&pageToken=${pageToken}`;
  return gmailFetch(path);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRawEmail({ to, subject, body, inReplyTo, threadId }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${inReplyTo}`);
  }
  lines.push('', body);
  return base64Encode(lines.join('\r\n'));
}

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64(data) {
  const safe = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(safe);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractName(fromHeader) {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : fromHeader.split('@')[0];
}

export { extractName };
