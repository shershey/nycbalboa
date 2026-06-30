#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// YSBD Balboa class scraper (prototype — read-only, no credentials).
//
// Fetches the next 8 weeks of classes from You Should Be Dancing's MindBody
// schedule widget, filters to Balboa classes, and prints them as JSON.
//
// Usage:
//   node scripts/fetch-ysbd.mjs            # Balboa classes, next 8 weeks, as JSON
//   node scripts/fetch-ysbd.mjs --all      # all classes (not just Balboa)
//   node scripts/fetch-ysbd.mjs --weeks 4  # change the number of weeks
//
// See GitHub issue #17 for the full plan (next step: write these into the
// Google Calendar from a daily GitHub Actions job).
// ─────────────────────────────────────────────────────────────────────────

const WIDGET_ID = '175532';
// IMPORTANT: use the JSONP endpoint (/load_markup, no `.json`) that YSBD's own
// widget calls. The `.json` twin intermittently returns HTTP 500 for far-out
// weeks; the JSONP endpoint serves the same data reliably. Response is wrapped
// as `callback({...json...});` — we strip the wrapper below.
const ENDPOINT = `https://widgets.mindbodyonline.com/widgets/schedules/${WIDGET_ID}/load_markup`;
const REFERER = 'https://www.youshouldbedancing.nyc/';
const DELAY_MS = 1000; // be polite: ~1s between weekly calls

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const WEEKS = (() => {
  const i = args.indexOf('--weeks');
  return i !== -1 && args[i + 1] ? parseInt(args[i + 1], 10) : 8;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each call returns a 7-day week starting at start_date, so step by 7 days.
function weekStartDates(weeks) {
  const out = [];
  const today = new Date();
  for (let w = 0; w < weeks; w++) {
    const d = new Date(today);
    d.setDate(d.getDate() + w * 7);
    out.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
  }
  return out;
}

// Unwrap a JSONP response: `jQuery_cb({...json...});` → the JSON inside.
function unwrapJsonp(body) {
  const open = body.indexOf('(');
  const close = body.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) throw new Error('not JSONP');
  return JSON.parse(body.slice(open + 1, close));
}

async function fetchWeek(startDate, attempts = 4) {
  // NOTE: params MUST be nested as options[...] — top-level start_date returns empty.
  // Uses the JSONP endpoint YSBD's own widget calls (see ENDPOINT note above);
  // `callback` names the wrapper fn, `_` is a cache-buster.
  const url =
    `${ENDPOINT}?callback=cb&options[start_date]=${startDate}&options[location]=` +
    `&widget_partner=object&widget_version=1&_=${startDate.replace(/-/g, '')}`;
  // Keep a short retry as defense-in-depth, though this endpoint is reliable.
  let lastErr;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          Accept: '*/*',
          Referer: REFERER,
          Origin: 'https://www.youshouldbedancing.nyc',
        },
      });
      if (res.ok) {
        const json = unwrapJsonp(await res.text());
        return json.class_sessions || '';
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (a < attempts) await sleep(800 * a);
  }
  throw lastErr;
}

// strip tags → collapsed text
function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSessions(html) {
  const sessions = [];
  // Split into per-day chunks; each has a date- class and its sessions.
  const dayChunks = html.split('<div class="bw-widget__day">').slice(1);
  for (const chunk of dayChunks) {
    const dateMatch = chunk.match(/date-(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const date = dateMatch[1];

    // Find each session CONTAINER: class="bw-session" optionally with modifiers
    // (e.g. "bw-session bw-session--canceled"). The trailing space/quote keeps
    // this from matching child elements like "bw-session__name".
    const starts = [...chunk.matchAll(/<div class="(bw-session(?: [^"]*)?)"/g)];
    for (let i = 0; i < starts.length; i++) {
      const containerClass = starts[i][1];
      const from = starts[i].index;
      const to = i + 1 < starts.length ? starts[i + 1].index : chunk.length;
      const block = chunk.slice(from, to);

      // Skip empty placeholder rows.
      if (/bw-session--empty/.test(containerClass)) continue;

      const start = block.match(/class="hc_starttime"\s+datetime="([^"]+)"/);
      const end = block.match(/class="hc_endtime"\s+datetime="([^"]+)"/);

      const nameBlock = block.match(/class="bw-session__name">([\s\S]*?)<\/div>/);
      let name = '';
      if (nameBlock) {
        // remove the hidden "bw-session__type" prefix span, then strip tags
        const cleaned = nameBlock[1].replace(/<span class="bw-session__type"[\s\S]*?<\/span>/, '');
        name = text(cleaned);
      }

      const level = (block.match(/class="bw-session__level"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
      const staff = (block.match(/class="bw-session__staff"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
      const mboClass = (block.match(/data-bw-widget-mbo-class="([^"]+)"/) || [])[1];
      const sessionId = (block.match(/id="(\d+)"/) || [])[1];
      // Real cancellation = a modifier on the container, NOT the always-present
      // hidden child <div class="bw-session__canceled">Cancelled</div>.
      const cancelled = /bw-session--cancel/i.test(containerClass);

      if (!name) continue;
      sessions.push({
        date,
        start: start ? start[1] : null, // e.g. "2026-07-07T19:30" (America/New_York local)
        end: end ? end[1] : null,
        name,
        level: level ? text(level) : null,
        instructor: staff ? text(staff) : null,
        cancelled,
        mboClassId: mboClass || null,
        sessionId: sessionId || null,
      });
    }
  }
  return sessions;
}

async function main() {
  const dates = weekStartDates(WEEKS);
  const all = [];
  for (const [i, d] of dates.entries()) {
    process.stderr.write(`Fetching week ${i + 1}/${dates.length} (start ${d})… `);
    try {
      const html = await fetchWeek(d);
      const found = parseSessions(html);
      all.push(...found);
      process.stderr.write(`${found.length} classes\n`);
    } catch (err) {
      process.stderr.write(`failed after retries: ${err.message}\n`);
    }
    if (i < dates.length - 1) await sleep(DELAY_MS);
  }

  // Dedupe by sessionId (defensive; weeks shouldn't overlap).
  const seen = new Set();
  let results = all.filter((s) => {
    const key = s.sessionId || `${s.date}|${s.start}|${s.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!ALL) results = results.filter((s) => /balboa/i.test(s.name));
  results.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  process.stderr.write(`\nFound ${results.length} ${ALL ? '' : 'Balboa '}classes across ${WEEKS} weeks.\n`);
  console.log(JSON.stringify(results, null, 2));
}

main();
