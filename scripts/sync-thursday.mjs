#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Thursday Night Practice → Google Calendar sync.
//
// Reads the organizer-maintained Google Sheet (source of truth) and writes one
// calendar event per upcoming practice date. Hosts / Time / More-info go in the
// description; Location goes in the event's location field. Only the public
// columns are used — the sheet's money/headcount/planning columns are ignored.
//
// Tagged `source=thursday-practice`, so it reconciles independently of the YSBD
// sync (no collisions) and shares all the same safety properties.
//
// SAFETY:
//   • Dry-run by default; pass --apply to write.
//   • If the sheet can't be read, abort without any changes.
//   • Only touches its own `thursday-practice`-tagged events, and only deletes
//     ones dated today-or-later (a removed sheet row → its future event goes).
//   • Skips creating a copy of anything an organizer already hand-entered.
//   • Skips quietly (exit 0) if credentials are absent.
//
// Env: GOOGLE_SERVICE_ACCOUNT_KEY, CALENDAR_ID (same as the YSBD sync).
// Usage: node scripts/sync-thursday.mjs [--apply]
// Install deps: npm install --prefix scripts
// ─────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

const SHEET_ID = '1457_9_HazwveO4VX_xu6pF9KRnpHneXE3q-nsNK3dug'; // shared with the service account (not secret)
const TIMEZONE = 'America/New_York';
const SOURCE_TAG = 'thursday-practice';
const SUMMARY = 'Thursday Balboa Practice';
const DEFAULT_TIME = { start: '19:30', end: '21:30' }; // fallback if a row's Time is blank/unparseable

const APPLY = process.argv.includes('--apply');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── date / time parsing ─────────────────────────────────────────────────────

function todayStr() {
  // Build YYYY-MM-DD for "today" in TIMEZONE without depending on locale string
  // formatting (toLocaleDateString output varies by the runtime's ICU data).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${o.year}-${o.month}-${o.day}`;
}

function ymd(year, mo, d) {
  const dt = new Date(Date.UTC(year, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // reject e.g. 2/30
  return dt.toISOString().slice(0, 10);
}

// Parse "M/D", "M/D/YYYY", "M/D/YY". Infer the year for no-year (or typo'd) cells
// by choosing whichever nearby year lands the date closest to today.
function parseDate(s, today) {
  const m = (s || '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const mo = +m[1];
  const d = +m[2];
  const thisYear = +today.slice(0, 10).slice(0, 4);
  let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null;
  if (y && (y < thisYear - 1 || y > thisYear + 2)) y = null; // typo guard (e.g. 4/24/3036)
  const todayMs = Date.parse(today.slice(0, 10) + 'T00:00:00Z');
  const candidates = y ? [y] : [thisYear - 1, thisYear, thisYear + 1];
  let best = null;
  for (const yr of candidates) {
    const iso = ymd(yr, mo, d);
    if (!iso) continue;
    const diff = Math.abs(Date.parse(iso + 'T00:00:00Z') - todayMs);
    if (!best || diff < best.diff) best = { iso, diff };
  }
  return best ? best.iso : null;
}

function parseOneTime(t) {
  const m = (t || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  return { h: +m[1], min: m[2] ? +m[2] : 0, ap: m[3] ? m[3].toLowerCase() : null };
}

// "7:30pm-9:30pm" → { start: "19:30", end: "21:30" }. am/pm carries across the dash.
function parseTimeRange(s) {
  const parts = (s || '').split(/[-–—]/);
  if (parts.length < 2) return null;
  const a = parseOneTime(parts[0]);
  const b = parseOneTime(parts[1]);
  if (!a || !b) return null;
  if (!a.ap && b.ap) a.ap = b.ap;
  if (!b.ap && a.ap) b.ap = a.ap;
  const to24 = (x) => {
    let h = x.h % 12;
    if (x.ap === 'pm') h += 12;
    return `${String(h).padStart(2, '0')}:${String(x.min).padStart(2, '0')}`;
  };
  return { start: to24(a), end: to24(b) };
}

// ── event building ──────────────────────────────────────────────────────────

const eventId = (date) => sha(`thursday|${date}`);

function contentHash(p) {
  return sha([p.hosts, p.time, p.location, p.moreInfo, p.start, p.end].join('|')).slice(0, 16);
}

function buildEvent(p) {
  const lines = [];
  if (p.hosts) lines.push(`Hosts: ${p.hosts}`);
  if (p.time) lines.push(`Time: ${p.time}`);
  if (p.moreInfo) lines.push('', `More info: ${p.moreInfo}`);
  lines.push('', 'Auto-synced from the NYC Balboa Thursday Practice schedule.');

  const event = {
    id: eventId(p.date),
    summary: SUMMARY,
    location: p.location || undefined,
    description: lines.join('\n'),
    start: { dateTime: `${p.date}T${p.start}:00`, timeZone: TIMEZONE },
    end: { dateTime: `${p.date}T${p.end}:00`, timeZone: TIMEZONE },
    extendedProperties: { private: { source: SOURCE_TAG, contentHash: contentHash(p) } },
  };
  if (/^https?:\/\//.test(p.moreInfo || '')) event.source = { title: 'More info', url: p.moreInfo };
  return event;
}

// ── hand-entered duplicate detection (same approach as the YSBD sync) ────────

const eventLocalDate = (s) => (s?.dateTime || s?.date || '').slice(0, 10);
function sameDayMatch(ours, hand) {
  if (eventLocalDate(ours.start) !== eventLocalDate(hand.start)) return false;
  return /thursday|practice/i.test(hand.summary || '');
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  const calendarId = process.env.CALENDAR_ID?.trim();
  if (!keyRaw || !calendarId) {
    console.error('GOOGLE_SERVICE_ACCOUNT_KEY and/or CALENDAR_ID not set — skipping Thursday sync.');
    process.exit(0);
  }

  const { google } = await import('googleapis');
  const key = JSON.parse(keyRaw);
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const calendar = google.calendar({ version: 'v3', auth });

  // 1. Read the sheet. Any failure → abort with no changes.
  let rows;
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const tab = meta.data.sheets[0].properties.title;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A1:Z200` });
    rows = res.data.values || [];
  } catch (err) {
    console.error('Could not read the Thursday sheet — aborting without changes:', err.message);
    process.exit(1);
  }
  if (rows.length < 2) {
    console.error('Sheet has no data rows — aborting.');
    process.exit(1);
  }

  // Map columns by header name (tolerant of reordering).
  const header = rows[0].map((h) => (h || '').trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const cDate = col('dates');
  const cHosts = col('hosts');
  const cInfo = col('more info');
  const cLoc = col('location');
  const cTime = col('time');
  if (cDate === -1) {
    console.error('Could not find a "Dates" column — aborting.');
    process.exit(1);
  }

  // 2. Build desired events from today-forward rows.
  const today = todayStr();
  const desired = new Map();
  let skippedPast = 0;
  let unparseable = 0;
  for (const r of rows.slice(1)) {
    const rawDate = r[cDate];
    if (!rawDate || !rawDate.trim()) continue;
    const date = parseDate(rawDate, today);
    if (!date) {
      unparseable++;
      continue;
    }
    if (date < today) {
      skippedPast++;
      continue;
    }
    const time = (cTime !== -1 && r[cTime]) ? r[cTime].trim() : '';
    const t = parseTimeRange(time) || DEFAULT_TIME;
    const p = {
      date,
      hosts: cHosts !== -1 ? (r[cHosts] || '').trim() : '',
      moreInfo: cInfo !== -1 ? (r[cInfo] || '').trim() : '',
      location: cLoc !== -1 ? (r[cLoc] || '').trim() : '',
      time,
      start: t.start,
      end: t.end,
    };
    desired.set(eventId(date), buildEvent(p)); // last row for a date wins
  }

  console.error(
    `Sheet: ${desired.size} upcoming practices (skipped ${skippedPast} past, ${unparseable} unparseable dates).`
  );

  // 3. List existing events in the window; split ours vs hand-entered.
  const dates = [...desired.values()].map((e) => e.start.dateTime.slice(0, 10)).sort();
  const lo = dates[0] || today;
  const hi = dates[dates.length - 1] || today;
  const pad = (d, n) => {
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const timeMin = `${pad(lo, -1)}T00:00:00Z`;
  const timeMax = `${pad(hi, 2)}T00:00:00Z`;

  const existing = new Map();
  const handEntered = [];
  let pageToken;
  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 250,
      pageToken,
    });
    for (const ev of res.data.items || []) {
      if (ev.status === 'cancelled') continue;
      if (ev.extendedProperties?.private?.source === SOURCE_TAG) existing.set(ev.id, ev);
      else handEntered.push(ev);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  // 4. Skip anything a human already hand-entered (a Thursday/practice event
  //    on the same day) — never duplicate or modify their event.
  const skipped = [];
  for (const [id, ev] of [...desired]) {
    const match = handEntered.find((h) => sameDayMatch(ev, h));
    if (match) {
      desired.delete(id);
      skipped.push({ ev, by: match.creator?.email || 'someone' });
    }
  }

  // 5. Reconcile. Deletes limited to our events dated today-or-later.
  const toInsert = [];
  const toUpdate = [];
  for (const [id, ev] of desired) {
    const cur = existing.get(id);
    if (!cur) toInsert.push(ev);
    else if (cur.extendedProperties?.private?.contentHash !== ev.extendedProperties.private.contentHash)
      toUpdate.push(ev);
  }
  const toDelete = [];
  for (const [id, ev] of existing) {
    if (desired.has(id)) continue;
    if (eventLocalDate(ev.start) >= today) toDelete.push(ev); // row removed from the sheet
  }

  // 6. Report + (optionally) apply.
  const label = (ev) => `${(ev.start?.dateTime || '').slice(0, 16)}  ${ev.summary}`;
  console.error(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — planned changes:`);
  console.error(`  create: ${toInsert.length}`);
  toInsert.forEach((e) => console.error(`    + ${label(e)}`));
  console.error(`  update: ${toUpdate.length}`);
  toUpdate.forEach((e) => console.error(`    ~ ${label(e)}`));
  console.error(`  delete: ${toDelete.length}`);
  toDelete.forEach((e) => console.error(`    - ${label(e)}`));
  console.error(`  skip (hand-entered already exists): ${skipped.length}`);
  skipped.forEach((s) => console.error(`    = ${label(s.ev)}  (kept ${s.by}'s)`));

  if (!APPLY) {
    console.error('\nDry run — no changes written. Re-run with --apply to commit.');
    return;
  }
  for (const ev of toInsert) await calendar.events.insert({ calendarId, requestBody: ev });
  for (const ev of toUpdate) await calendar.events.update({ calendarId, eventId: ev.id, requestBody: ev });
  for (const ev of toDelete) await calendar.events.delete({ calendarId, eventId: ev.id });
  console.error(`\nDone. Created ${toInsert.length}, updated ${toUpdate.length}, deleted ${toDelete.length}.`);
}

main().catch((err) => {
  console.error('\nThursday sync failed:', err.message);
  process.exit(1);
});
