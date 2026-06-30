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
const ENDPOINT = `https://widgets.mindbodyonline.com/widgets/schedules/${WIDGET_ID}/load_markup.json`;
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

async function fetchWeek(startDate) {
  // NOTE: params MUST be nested as options[...] — top-level start_date returns empty.
  const url = `${ENDPOINT}?options[start_date]=${startDate}&options[location]=`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'nycbalboa-calendar-sync (https://nycbalboa.com)',
      Referer: REFERER,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  // MindBody returns 500 for weeks beyond the currently-published schedule.
  // Treat that as "not published yet" (empty), not a hard failure.
  if (res.status === 500) return { html: '', unpublished: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return { html: json.class_sessions || '', unpublished: false };
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

    // Per-session substrings.
    const blocks = chunk.split('<div class="bw-session"').slice(1);
    for (const block of blocks) {
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
      const sessionId = (block.match(/^[^>]*id="(\d+)"/) || [])[1];
      const cancelled = /bw-session__canceled/.test(block) || /Cancelled/i.test(block.slice(0, 600));

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
      const { html, unpublished } = await fetchWeek(d);
      if (unpublished) {
        process.stderr.write('not published yet\n');
      } else {
        const found = parseSessions(html);
        all.push(...found);
        process.stderr.write(`${found.length} classes\n`);
      }
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
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
