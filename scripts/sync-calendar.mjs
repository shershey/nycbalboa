#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// YSBD → Google Calendar sync.
//
// Scrapes YSBD Balboa classes (via fetch-ysbd.mjs) and reconciles them into a
// Google Calendar: insert new classes, update changed ones, delete ones that
// disappeared or were cancelled. Only ever touches events it created itself
// (tagged extendedProperties.private.source = 'ysbd-sync'), so hand-entered
// events are never modified — honoring the "one source of truth" rule.
//
// SAFETY:
//   • Dry-run by DEFAULT. Pass --apply to actually write.
//   • Deletes are scoped to weeks that fetched successfully. A week that failed
//     to fetch is "unknown", never "empty" — its events are left alone, so a
//     MindBody outage can never wipe real calendar entries.
//   • If NO weeks fetch successfully, the run aborts without writing anything.
//   • If credentials are absent, the run skips quietly (exit 0) — so a daily
//     job scheduled before the service account exists doesn't error every day.
//
// Env:
//   GOOGLE_SERVICE_ACCOUNT_KEY  Service-account JSON key (the whole file's
//                               contents as a string). From GitHub Secrets.
//   CALENDAR_ID                 Target calendar ID (…@group.calendar.google.com).
//
// Usage:
//   node scripts/sync-calendar.mjs            # dry run — prints planned changes
//   node scripts/sync-calendar.mjs --apply    # actually write to the calendar
//   node scripts/sync-calendar.mjs --weeks 4  # change lookahead (default 12)
//
// Install deps first:  npm install --prefix scripts
// See GitHub issue #17 for the full plan.
// ─────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { scrape } from './fetch-ysbd.mjs';

const TIMEZONE = 'America/New_York';
const SOURCE_TAG = 'ysbd-sync';
const LOCATION = 'You Should Be Dancing!';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const wi = args.indexOf('--weeks');
const WEEKS = wi !== -1 && args[wi + 1] ? parseInt(args[wi + 1], 10) : 12;

// ── helpers ───────────────────────────────────────────────────────────────

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Deterministic, stable calendar event id derived from the class identity.
// sha256 hex is [0-9a-f], a valid subset of Google's allowed id charset
// (lowercase a-v + 0-9), so this is a legal event id with no transformation.
function eventId(cls) {
  return sha(`ysbd|${cls.date}|${cls.start}|${cls.name}`);
}

// A short hash of the meaningful fields, stored on the event so we can tell
// whether an existing event needs updating without comparing date formats.
function contentHash(cls) {
  return sha(
    [cls.name, cls.start, cls.end, cls.level, cls.instructor, cls.registerUrl].join('|')
  ).slice(0, 16);
}

function buildEvent(cls) {
  const descLines = [];
  if (cls.level) descLines.push(`Level: ${cls.level}`);
  if (cls.instructor) descLines.push(`Instructor: ${cls.instructor}`);
  if (cls.registerUrl) descLines.push('', `Register: ${cls.registerUrl}`);
  descLines.push('', 'Auto-synced from You Should Be Dancing (youshouldbedancing.nyc).');

  const event = {
    id: eventId(cls),
    summary: cls.name,
    location: LOCATION,
    description: descLines.join('\n'),
    start: { dateTime: `${cls.start}:00`, timeZone: TIMEZONE },
    end: { dateTime: `${cls.end}:00`, timeZone: TIMEZONE },
    extendedProperties: {
      private: {
        source: SOURCE_TAG,
        contentHash: contentHash(cls),
        sessionId: cls.sessionId || '',
        mboClassId: cls.mboClassId || '',
      },
    },
  };
  if (cls.registerUrl) event.source = { title: 'Register', url: cls.registerUrl };
  return event;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Scrape, tracking which weeks succeeded.
  const { classes, weeks } = await scrape({
    weeks: WEEKS,
    onProgress: (n, total, s) =>
      process.stderr.write(
        `Fetching week ${n}/${total} (start ${s.start})… ` +
          (s.ok ? `${s.count} classes\n` : `FAILED: ${s.error}\n`)
      ),
  });

  const okWeeks = weeks.filter((w) => w.ok);
  if (okWeeks.length === 0) {
    console.error('\nNo weeks fetched successfully — aborting without any changes.');
    process.exit(1);
  }

  // Covered local dates = the 7 days of every successfully-fetched week. Deletes
  // are restricted to these; events in un-fetched weeks are left untouched.
  const coveredDates = new Set();
  for (const w of okWeeks) for (let i = 0; i < 7; i++) coveredDates.add(addDays(w.start, i));

  // Desired events: every non-cancelled class. (A cancelled class is simply
  // absent from the desired set, so the reconcile pass deletes any event we
  // previously created for it.)
  const desired = new Map();
  for (const cls of classes) {
    if (cls.cancelled) continue;
    if (!cls.start || !cls.end) continue;
    desired.set(eventId(cls), buildEvent(cls));
  }

  const cancelledCount = classes.filter((c) => c.cancelled).length;
  process.stderr.write(
    `\n${okWeeks.length}/${weeks.length} weeks fetched. ` +
      `${desired.size} active classes, ${cancelledCount} cancelled.\n`
  );

  // 2. Credentials. Absent → skip quietly so a pre-setup cron doesn't error.
  const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const calendarId = process.env.CALENDAR_ID;
  if (!keyRaw || !calendarId) {
    console.error(
      '\nGOOGLE_SERVICE_ACCOUNT_KEY and/or CALENDAR_ID not set — skipping calendar sync.\n' +
        '(This is expected before the service account is configured.)'
    );
    process.exit(0);
  }

  const { google } = await import('googleapis');
  const key = JSON.parse(keyRaw);
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const calendar = google.calendar({ version: 'v3', auth });

  // 3. List our existing (ysbd-sync) events across the covered span. Pad the
  //    query window generously; we filter precisely by covered local date below.
  const sortedDates = [...coveredDates].sort();
  const timeMin = `${addDays(sortedDates[0], -1)}T00:00:00Z`;
  const timeMax = `${addDays(sortedDates[sortedDates.length - 1], 2)}T00:00:00Z`;

  const existing = new Map();
  let pageToken;
  do {
    const res = await calendar.events.list({
      calendarId,
      privateExtendedProperty: `source=${SOURCE_TAG}`,
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 250,
      pageToken,
    });
    for (const ev of res.data.items || []) existing.set(ev.id, ev);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  // 4. Reconcile.
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
    const localDate = (ev.start?.dateTime || ev.start?.date || '').slice(0, 10);
    if (coveredDates.has(localDate)) toDelete.push(ev); // disappeared or cancelled
  }

  // 5. Report + (optionally) apply.
  const label = (ev) => `${(ev.start?.dateTime || '').slice(0, 16)}  ${ev.summary}`;
  console.error(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — planned changes:`);
  console.error(`  create: ${toInsert.length}`);
  toInsert.forEach((e) => console.error(`    + ${label(e)}`));
  console.error(`  update: ${toUpdate.length}`);
  toUpdate.forEach((e) => console.error(`    ~ ${label(e)}`));
  console.error(`  delete: ${toDelete.length}`);
  toDelete.forEach((e) => console.error(`    - ${label(e)}`));

  if (!APPLY) {
    console.error('\nDry run — no changes written. Re-run with --apply to commit.');
    return;
  }

  for (const ev of toInsert) {
    await calendar.events.insert({ calendarId, requestBody: ev });
  }
  for (const ev of toUpdate) {
    await calendar.events.update({ calendarId, eventId: ev.id, requestBody: ev });
  }
  for (const ev of toDelete) {
    await calendar.events.delete({ calendarId, eventId: ev.id });
  }
  console.error(
    `\nDone. Created ${toInsert.length}, updated ${toUpdate.length}, deleted ${toDelete.length}.`
  );
}

main().catch((err) => {
  console.error('\nSync failed:', err.message);
  process.exit(1);
});
