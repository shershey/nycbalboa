# NYC Balboa

Community website for the NYC Balboa swing dance scene (nycbalboa.com). Maintained by volunteer organizers. This file is the shared instruction set for **every** person and AI agent working in this repo (Codex reads it directly; `CLAUDE.md` points here).

> **Working with a non-technical editor?** If the person you're helping says they're in editor mode, or their personal instructions point to it, also follow [`docs/editor-mode.md`](docs/editor-mode.md). Design direction lives in [`docs/design-brief.md`](docs/design-brief.md) — follow it for any visual or copy change.

## What this site is

1. **Events calendar** — all NYC Balboa events. Source of truth is a shared Google Calendar, so organizers add/edit events without touching this repo.
2. **Content pages** — Begin, Socials, Learn, Resources, Weekly Practice. Copy lives in Markdown files in `src/content/`.
3. **Subdomain apps** — advanced contributors can run their own apps at `*.nycbalboa.com` via DNS CNAME. Independent deployments, NOT part of this repo.

## Site map (where things live)

| On the site | URL | Words live in | Page template |
|---|---|---|---|
| Homepage intro | `/` | `src/content/homepage.md` | `src/pages/index.astro` (also: title, social icons, "Upcoming Events" list from the calendar) |
| Begin | `/begin` | `src/content/begin.md` | `src/pages/begin.astro` |
| Socials | `/socials` | `src/content/socials.md` | `src/pages/socials.astro` |
| Learn | `/learn` | `src/content/learn.md` | `src/pages/learn.astro` |
| Calendar | `/calendar` | `src/content/events.md` (intro text only) | `src/pages/calendar.astro` (Google Calendar embed) |
| Resources | `/resources` | `src/content/resources.md` | `src/pages/resources.astro` |
| Weekly Practice | `/weekly-practice` (also `/wednesday-practice`, `/thursday-practice`) | `src/content/weekly-practice.md` | three identical page files — keep them in sync or turn the extras into redirects |
| Top menu, footer, colors, fonts, site-wide styles | every page | — | `src/layouts/Layout.astro` |
| Old URLs that redirect | `/offerings` → `/learn`, `/events` → `/calendar` | — | `astro.config.mjs` |

Known duplication: the Instagram/Discord/Facebook links appear in both `Layout.astro` (footer) and `index.astro` (homepage header) and as text in `resources.md`. Update all of them together.

## Stack

- **Framework:** Astro 4, `output: "hybrid"` with the Cloudflare adapter. The homepage is server-rendered on each request (it fetches upcoming events from the public calendar feed via `src/lib/google-calendar.js`); other pages are static.
- **Hosting:** Cloudflare (Workers + static assets, `wrangler.jsonc`) — auto-deploys on push to `main`. **Merging to `main` = publishing.**
- **Local preview:** `npm install` once, then `npm run dev` → http://localhost:4321 (live-reloads as files change).
- **Codex desktop app:** the project's local-environment config (setup script `npm install`, **Preview site** action `npm run dev`) lives in `.codex/`. Keep it committed.
- **Build check:** `npm run build` must succeed before anything is merged. CI runs it on every pull request (`.github/workflows/build-check.yml`).
- **Domain:** nycbalboa.com, DNS on Cloudflare.

## Conventions

- Never commit directly to `main`. One change = one branch = one pull request. Keep PRs small and describe them in plain English.
- Edit words in `src/content/*.md` whenever possible rather than in `.astro` templates.
- Reuse the color variables in `Layout.astro` (`--burgundy`, `--brass`, etc.) instead of inventing new hex values.
- **Mobile-first** — most visitors arrive on phones at or before a dance. Check every visual change at phone width (~390px) as well as desktop.
- Keep the homepage fast and simple — it's the address on flyers and Instagram.
- **Aesthetic:** Balboa is a vintage 1930s–40s swing dance. Warm, classic, readable — not trendy or neon. Details in `docs/design-brief.md`.
- Secrets (API keys, tokens) go in a gitignored `.env`, or **GitHub Secrets** for CI. Never commit them.
- **Never hardcode event data into the repo** — events come from the Google Calendar.

## Before you call a change done

1. `npm run build` passes.
2. With `npm run dev` running, every page in the site map loads, and the page you changed looks right at desktop and phone widths.
3. Links you added or changed go where they should.
4. Nothing outside the scope of the request changed (`git diff` is small and on-topic).

## Ask a maintainer (Shawn or the repo owners) before touching

- `astro.config.mjs`, `wrangler.jsonc`, `package.json` / `package-lock.json` (build, hosting, dependencies)
- `.github/workflows/`, `scripts/`, `src/lib/google-calendar.js` (calendar automation — see invariants below)
- The calendar ID/embed URL in `src/pages/calendar.astro`
- Deleting a page or changing a page's URL (flyers and Instagram link to these — add a redirect instead)
- DNS, domain, Cloudflare or GitHub settings

## Calendar automation (events sync)

The Google Calendar is **auto-populated daily** from external sources, alongside events organizers add by hand. Lives in `scripts/` + a GitHub Actions cron. Full history & decisions: **GitHub issue #17**.

- **Sources:** YSBD (You Should Be Dancing) class/workshop/party schedule, and a private Thursday Practice Google Sheet. Each reconciled into the same calendar.
- **`scripts/fetch-ysbd.mjs`** — scrapes YSBD's three MindBody/Healcode schedule widgets via the **JSONP** `load_markup` endpoint (the `.json` twin flakes with intermittent 500s — use JSONP). Keeps anything mentioning "balboa" in name OR description.
- **`scripts/sync-calendar.mjs`** (YSBD) and **`scripts/sync-thursday.mjs`** (sheet) — reconcile insert/update/delete into the calendar.
- **Daily job:** `.github/workflows/ysbd-sync.yml`, cron 11:00 UTC, two steps (YSBD + Thursday). `.github/workflows/practice-dry-run.yml` is a manual read-only preview.
- **Auth:** Google service account (`calendar-sync@nycbalboa-sync.iam.gserviceaccount.com`, "Make changes to events"); key + calendar id in GitHub Secrets (`GOOGLE_SERVICE_ACCOUNT_KEY`, `CALENDAR_ID`). `scripts/package.json` keeps `googleapis` OUT of the site build.

**Safety invariants — do not break these:**
- **Dry-run by default**; `--apply` writes. Live switch = repo variable `YSBD_SYNC_APPLY=true`.
- Each source only touches its OWN events, tagged `extendedProperties.private.source` (`ysbd-sync` / `thursday-practice`). **Hand-entered events are never modified or deleted.**
- **Hand-entered dedup:** if a human already added a matching event, the sync skips creating its own.
- Deterministic event IDs (hash of date|start|name) → idempotent, no duplicates.
- A failed fetch/sheet-read is "unknown," never "empty" — the sync aborts rather than deleting on an outage.

## Notes

- The iframe embed is the calendar **display**; the service account only **writes** synced events. Keep the iframe until there's a real reason to upgrade.
- Google Calendar must stay "Make available to public → See all event details" or events disappear for visitors.
- Calendar embed: Month view on desktop (≥640px), Agenda view on mobile (<640px), switched on resize.
- Roadmap: styling pass; later, a custom-styled calendar via the Google Calendar API.
