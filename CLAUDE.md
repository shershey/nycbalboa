# NYC Balboa

Community website for the NYC Balboa swing dance scene. Maintained by volunteer organizers; built and extended using Claude Code.

## What this site is

A hub with three parts:

1. **Events calendar** — all NYC Balboa events. Source of truth is a shared Google Calendar so any organizer can add/edit events without touching this repo.
2. **Offerings directory** — standing list of NYC Balboa classes, dances, and communities (name, type, neighborhood, level, price, link). Source of truth is Airtable or Google Sheets (TBD).
3. **Subdomain apps** — advanced contributors can run their own apps at `*.nycbalboa.com` via DNS CNAME. These are independent deployments, NOT part of this repo.

## Architecture principle

Content that non-technical organizers edit lives OUTSIDE the code. This site reads from those sources and renders them. **Never hardcode event or offering data into the repo** — always read from the source of truth.

## Stack

- **Framework:** Astro (static-first)
- **Hosting:** Cloudflare Pages — auto-deploys on push to `main`
- **Build:** `npm run build`, output dir `dist`
- **Content sources:** Google Calendar (events), Airtable or Google Sheets (offerings directory)
- **Domain:** nycbalboa.com (registrar/DNS TBD)

## Conventions

- Secrets (API keys, tokens) go in a gitignored `.env` — or **GitHub Secrets** for CI (the calendar sync's service-account key + calendar id). Never commit them.
- Keep the homepage fast and simple — it's the address on flyers and Instagram.
- **Mobile-first** — most visitors arrive on phones at or before a dance.
- **Aesthetic:** Balboa is a vintage 1930s–40s swing dance. Warm, classic, and readable — not trendy or neon.

## Build order

1. ✅ Skeleton homepage deploying to Cloudflare Pages
2. ✅ Events page — embedded Google Calendar iframe
3. ✅ Offerings page — Google Sheet as source of truth, client-side fetch, grouped by category
4. Styling pass
5. ✅ Calendar automation — daily sync of YSBD events + Thursday practice into the Google Calendar (see below)
6. *(Later)* Custom-styled calendar via Google Calendar API, payments, subdomains

## Implemented design decisions

- **Offerings data source:** Google Sheets, published as CSV, fetched client-side at page load (not build time) so updates appear without redeploying. URL is hardcoded (it's public, not a secret).
- **Offerings layout:** Four category cards (Weekly, Monthly, Big Events, Private Lessons) in a responsive grid. Items within each category are randomized on every page load.
- **Events calendar:** Google Calendar iframe embed. Month view on desktop (≥640px), Agenda view on mobile (<640px), switches dynamically on resize.
- **Google Calendar public access:** Calendar must be set to "Make available to public" → "See all event details" (not free/busy) or events won't appear to non-logged-in visitors.

## Calendar automation (events sync)

The Google Calendar the iframe embeds is **auto-populated daily** from external sources, alongside events organizers add by hand. Lives in `scripts/` + a GitHub Actions cron. Full history & decisions: **GitHub issue #17**.

- **Sources:** YSBD (You Should Be Dancing) class/workshop/party schedule, and a private Thursday Practice Google Sheet. Each reconciled into the same calendar.
- **`scripts/fetch-ysbd.mjs`** — scrapes YSBD's three MindBody/Healcode schedule widgets via the **JSONP** `load_markup` endpoint (the `.json` twin flakes with intermittent 500s — use JSONP). Keeps anything mentioning "balboa" in name OR description (so a swing party whose blurb mentions Balboa is kept; Tango/Latin nights aren't).
- **`scripts/sync-calendar.mjs`** (YSBD) and **`scripts/sync-thursday.mjs`** (sheet) — reconcile insert/update/delete into the calendar.
- **Daily job:** `.github/workflows/ysbd-sync.yml`, cron 11:00 UTC, two steps (YSBD + Thursday).
- **Auth:** Google service account (`calendar-sync@nycbalboa-sync.iam.gserviceaccount.com`, "Make changes to events"); key + calendar id in GitHub Secrets (`GOOGLE_SERVICE_ACCOUNT_KEY`, `CALENDAR_ID`). Thursday sheet shared with that account (Viewer); Sheets API enabled. `scripts/package.json` keeps `googleapis` OUT of the Cloudflare site build.

**Safety invariants — do not break these:**
- **Dry-run by default**; `--apply` writes. Live go-live switch = repo variable `YSBD_SYNC_APPLY=true`.
- Each source only touches its OWN events, tagged `extendedProperties.private.source` (`ysbd-sync` / `thursday-practice`). **Hand-entered events are never modified or deleted.**
- **Hand-entered dedup:** if a human already added a matching event (same date, close time, similar name), the sync skips creating its own — defers to the human.
- Deterministic event IDs (hash of date|start|name) → idempotent, no duplicates.
- A failed fetch/sheet-read is "unknown," never "empty" — the sync aborts/leaves events alone rather than deleting on an outage.

## Notes

- The iframe embed is still the **display**; the service account is used only to **write** synced events into that calendar, not to render it. Keep the display on the iframe until there's a real reason to upgrade.
- One source of truth per data type: one calendar, one directory. Each automated source owns only its tagged events.
