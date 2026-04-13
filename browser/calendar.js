// browser/calendar.js
// Google Calendar API module.
// Auth is shared with Gmail — same chrome.identity token.

import { getAuthToken, removeCachedToken } from './gmail.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const PRIMARY      = 'primary';

// ─── Shared fetch ─────────────────────────────────────────────────────────────

async function calFetch(path, options = {}) {
  let token = await getAuthToken();
  const url = path.startsWith('http') ? path : `${CALENDAR_API}${path}`;

  const doReq = (t) =>
    fetch(url, {
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

  // 204 No Content (DELETE) is success with empty body
  if (res.status === 204) return { ok: true };

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Calendar API error: HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Get events by time range ─────────────────────────────────────────────────

export async function getEvents(timeMin, timeMax, maxResults = 15) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults,
    singleEvents: 'true',
    orderBy:      'startTime',
  });
  const data = await calFetch(`/calendars/${PRIMARY}/events?${params}`);
  return (data.items || []).map(parseEvent);
}

// ─── Convenience windows ──────────────────────────────────────────────────────

export function getEventsToday() {
  const d = new Date();
  const start = startOf(d);
  const end   = endOf(d);
  return getEvents(start.toISOString(), end.toISOString());
}

export function getEventsTomorrow() {
  const d = addDays(new Date(), 1);
  return getEvents(startOf(d).toISOString(), endOf(d).toISOString());
}

export function getEventsThisWeek() {
  const now   = new Date();
  const start = startOf(now);
  const end   = endOf(addDays(now, 6));
  return getEvents(start.toISOString(), end.toISOString(), 25);
}

export function getEventsNextWeek() {
  const now   = new Date();
  const start = startOf(addDays(now, 7));
  const end   = endOf(addDays(now, 13));
  return getEvents(start.toISOString(), end.toISOString(), 25);
}

export async function getNextEvent() {
  const now  = new Date();
  const end  = addDays(now, 30);
  const list = await getEvents(now.toISOString(), end.toISOString(), 5);
  return list[0] ?? null;
}

export function getUpcomingEvents(maxResults = 5) {
  const now = new Date();
  const end = addDays(now, 30);
  return getEvents(now.toISOString(), end.toISOString(), maxResults);
}

export function getEventsForDate(dateStr) {
  const d = new Date(dateStr);
  return getEvents(startOf(d).toISOString(), endOf(d).toISOString());
}

// ─── Create event ─────────────────────────────────────────────────────────────

export async function createEvent({ title, startDateTime, endDateTime, description = '', location = '', allDay = false }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = allDay
    ? {
        summary:     title,
        description,
        location,
        start: { date: startDateTime },
        end:   { date: endDateTime || startDateTime },
      }
    : {
        summary:     title,
        description,
        location,
        start: { dateTime: startDateTime, timeZone: tz },
        end:   { dateTime: endDateTime,   timeZone: tz },
      };
  const event = await calFetch(`/calendars/${PRIMARY}/events`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
  return parseEvent(event);
}

// ─── Update event ─────────────────────────────────────────────────────────────

export async function updateEventTitle(eventId, newTitle) {
  return calFetch(`/calendars/${PRIMARY}/events/${eventId}`, {
    method: 'PATCH',
    body:   JSON.stringify({ summary: newTitle }),
  });
}

// ─── Delete event ─────────────────────────────────────────────────────────────

export async function deleteEvent(eventId) {
  return calFetch(`/calendars/${PRIMARY}/events/${eventId}`, { method: 'DELETE' });
}

// ─── Parse event ──────────────────────────────────────────────────────────────

export function parseEvent(evt) {
  const startRaw = evt.start?.dateTime || evt.start?.date || '';
  const endRaw   = evt.end?.dateTime   || evt.end?.date   || '';
  const isAllDay = !evt.start?.dateTime;

  return {
    id:          evt.id,
    title:       evt.summary || '(No title)',
    start:       startRaw,
    end:         endRaw,
    isAllDay,
    description: evt.description || '',
    location:    evt.location    || '',
    htmlLink:    evt.htmlLink    || '',
    spoken:      spokenEvent(evt.summary, startRaw, endRaw, isAllDay),
  };
}

// ─── Speech helpers ───────────────────────────────────────────────────────────

export function spokenEvent(title, start, end, isAllDay) {
  if (!start) return title || '(no title)';
  try {
    const s = new Date(start);
    if (isAllDay) return `${title} — all day`;
    const startTime = s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!end) return `${title} at ${startTime}`;
    const e = new Date(end);
    const endTime = e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${title} from ${startTime} to ${endTime}`;
  } catch {
    return title;
  }
}

export function spokenDate(isoDateStr) {
  try {
    return new Date(isoDateStr).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  } catch { return isoDateStr; }
}

export function formatEventList(events) {
  if (!events.length) return null;
  return events.map((e, i) => `${i + 1}: ${e.spoken}`).join('. ');
}

// ─── Date utilities ───────────────────────────────────────────────────────────

function startOf(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOf(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Returns ISO date string (YYYY-MM-DD) for "today", "tomorrow", "next monday" etc.
 *  Returns null if it can not resolve. Used as a fallback before AI parsing. */
export function quickDateParse(lower) {
  const now = new Date();
  if (/\btoday\b/.test(lower))    return toISODate(now);
  if (/\btomorrow\b/.test(lower)) return toISODate(addDays(now, 1));
  if (/\byesterday\b/.test(lower))return toISODate(addDays(now, -1));

  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const next = lower.match(/next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (next) {
    const target = weekdays.indexOf(next[1]);
    const diff   = ((target - now.getDay() + 7) % 7) || 7;
    return toISODate(addDays(now, diff));
  }
  const thisDay = lower.match(/this\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (thisDay) {
    const target = weekdays.indexOf(thisDay[1]);
    const diff   = (target - now.getDay() + 7) % 7;
    return toISODate(addDays(now, diff));
  }
  return null;
}

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** Build a full ISO datetime from a date string (YYYY-MM-DD) and a time string like "3pm", "14:30", "2:30 pm" */
export function buildDateTime(dateStr, timeStr) {
  if (!timeStr) return `${dateStr}T09:00:00`;

  const t = timeStr.toLowerCase().trim();
  const ampm = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2] || '0', 10);
    if (ampm[3] === 'pm' && h < 12) h += 12;
    if (ampm[3] === 'am' && h === 12) h = 0;
    return `${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
  }
  const hm = t.match(/(\d{1,2}):(\d{2})/);
  if (hm) {
    return `${dateStr}T${String(hm[1]).padStart(2,'0')}:${hm[2]}:00`;
  }
  return `${dateStr}T09:00:00`;
}

/** Add N hours to an ISO datetime string */
export function addHours(isoDateTime, hours) {
  const d = new Date(isoDateTime);
  d.setHours(d.getHours() + hours);
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}
