#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// YSBD Balboa scraper (read-only, no credentials).
//
// Fetches the next 12 weeks from You Should Be Dancing's three MindBody
// schedule widgets — group classes, workshops, and dance parties — and keeps
// anything that mentions "balboa" anywhere in its name OR description. (So a
// "Swing Party" whose blurb talks about Balboa is kept; a Tango night isn't.)
// Prints the result as JSON.
//
// Usage:
//   node scripts/fetch-ysbd.mjs            # Balboa events, next 12 weeks, as JSON
//   node scripts/fetch-ysbd.mjs --all      # everything (no balboa filter)
//   node scripts/fetch-ysbd.mjs --weeks 4  # change the number of weeks
//
// See GitHub issue #17 for the full plan.
// ─────────────────────────────────────────────────────────────────────────

// The three YSBD schedule widgets. The numeric id decodes from the page's
// healcode hash `a3<id>6ad9` (e.g. classes a31755326ad9 → 175532).
const WIDGETS = [
  { id: '175532', kind: 'class' }, // /group-classes
  { id: '215147', kind: 'workshop' }, // /workshops
  { id: '176833', kind: 'party' }, // /dance-parties-1
];

// IMPORTANT: use the JSONP endpoint (/load_markup, no `.json`) that YSBD's own
// widget calls. The `.json` twin intermittently returns HTTP 500 for far-out
// weeks; the JSONP endpoint serves the same data reliably. Response is wrapped
// as `callback({...json...});` — we strip the wrapper below.
const endpoint = (widgetId) =>
  `https://widgets.mindbodyonline.com/widgets/schedules/${widgetId}/load_markup`;
const REFERER = 'https://www.youshouldbedancing.nyc/';
const DELAY_MS = 700; // be polite between calls

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

// Unwrap a JSONP response: `cb({...json...});` → the JSON inside.
function unwrapJsonp(body) {
  const open = body.indexOf('(');
  const close = body.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) throw new Error('not JSONP');
  return JSON.parse(body.slice(open + 1, close));
}

async function fetchWeek(widgetId, startDate, attempts = 4) {
  // NOTE: params MUST be nested as options[...] — top-level start_date returns empty.
  const url =
    `${endpoint(widgetId)}?callback=cb&options[start_date]=${startDate}&options[location]=` +
    `&widget_partner=object&widget_version=1&_=${startDate.replace(/-/g, '')}`;
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

function parseSessions(html, kind) {
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
      let type = null;
      if (nameBlock) {
        // The hidden "bw-session__type" prefix span holds the category
        // ("Balboa - ", "Swing Party - ", …). Capture it, then strip it.
        const typeSpan = nameBlock[1].match(/<span class="bw-session__type"[^>]*>([\s\S]*?)<\/span>/);
        if (typeSpan) type = text(typeSpan[1]).replace(/\s*-\s*$/, '') || null;
        name = text(nameBlock[1].replace(/<span class="bw-session__type"[\s\S]*?<\/span>/, ''));
      }

      const level = (block.match(/class="bw-session__level"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
      const staff = (block.match(/class="bw-session__staff"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
      // Description lives in the expanded details; it can contain nested divs,
      // so capture greedily from its open tag to the end of the session block.
      const descMatch = block.match(/class="bw-session__description"[^>]*>([\s\S]*)/);
      const description = descMatch ? text(descMatch[1]) || null : null;
      const mboClass = (block.match(/data-bw-widget-mbo-class="([^"]+)"/) || [])[1];
      const sessionId = (block.match(/id="(\d+)"/) || [])[1];
      // Direct "Register" deep link to MindBody for this item on this date.
      const reg = (block.match(/class="[^"]*signup_now[^"]*"[^>]*href="([^"]+)"/) || [])[1];
      const registerUrl = reg ? reg.replace(/&amp;/g, '&') : null;
      // Real cancellation = a modifier on the container, NOT the always-present
      // hidden child <div class="bw-session__canceled">Cancelled</div>.
      const cancelled = /bw-session--cancel/i.test(containerClass);

      if (!name) continue;
      sessions.push({
        date,
        start: start ? start[1] : null, // e.g. "2026-07-07T19:30" (America/New_York local)
        end: end ? end[1] : null,
        name,
        kind, // class | workshop | party
        type, // YSBD category label, e.g. "Swing Party"
        level: level ? text(level) : null,
        instructor: staff ? text(staff) : null,
        description,
        cancelled,
        mboClassId: mboClass || null,
        sessionId: sessionId || null,
        registerUrl,
      });
    }
  }
  return sessions;
}

// Keep events whose name OR description mentions balboa.
const mentionsBalboa = (s) => /balboa/i.test(`${s.name} ${s.type || ''} ${s.description || ''}`);

// Scrape `weeks` weeks across all three widgets. Returns the parsed events AND
// the per-week fetch status. A week is only marked ok (and thus eligible for
// deletions in the calendar sync) if EVERY widget fetched successfully — a
// partial week is "unknown", never "empty", so the sync never wrongly deletes.
export async function scrape({ weeks = 12, all = false, onProgress } = {}) {
  const dates = weekStartDates(weeks);
  const weekStatus = [];
  const collected = [];
  for (const [i, d] of dates.entries()) {
    let weekOk = true;
    let count = 0;
    for (const w of WIDGETS) {
      try {
        const html = await fetchWeek(w.id, d);
        const found = parseSessions(html, w.kind);
        collected.push(...found);
        count += found.length;
      } catch (err) {
        weekOk = false;
        weekStatus.errored = err.message;
      }
      await sleep(DELAY_MS);
    }
    const status = { start: d, ok: weekOk, count };
    weekStatus.push(status);
    if (onProgress) onProgress(i + 1, dates.length, status);
  }

  // Dedupe by sessionId (defensive; widgets/weeks shouldn't overlap).
  const seen = new Set();
  let classes = collected.filter((s) => {
    const key = s.sessionId || `${s.date}|${s.start}|${s.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!all) classes = classes.filter(mentionsBalboa);
  classes.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  return { classes, weeks: weekStatus };
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const wi = args.indexOf('--weeks');
  const weeks = wi !== -1 && args[wi + 1] ? parseInt(args[wi + 1], 10) : 12;

  const { classes } = await scrape({
    weeks,
    all,
    onProgress: (n, total, s) =>
      process.stderr.write(
        `Week ${n}/${total} (start ${s.start})… ` +
          (s.ok ? `${s.count} items\n` : `INCOMPLETE (a widget failed)\n`)
      ),
  });

  process.stderr.write(`\nFound ${classes.length} ${all ? '' : 'Balboa '}events across ${weeks} weeks.\n`);
  console.log(JSON.stringify(classes, null, 2));
}

// Run the CLI only when invoked directly (not when imported by the sync script).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
