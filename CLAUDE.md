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

- Secrets (API keys, tokens) go in a gitignored `.env`. Never commit them.
- Keep the homepage fast and simple — it's the address on flyers and Instagram.
- **Mobile-first** — most visitors arrive on phones at or before a dance.
- **Aesthetic:** Balboa is a vintage 1930s–40s swing dance. Warm, classic, and readable — not trendy or neon.

## Build order

1. ✅ Skeleton homepage deploying to Cloudflare Pages
2. ✅ Events page — embedded Google Calendar iframe
3. ✅ Offerings page — Google Sheet as source of truth, client-side fetch, grouped by category
4. Styling pass
5. *(Later)* Custom-styled calendar via Google Calendar API, payments, subdomains

## Implemented design decisions

- **Offerings data source:** Google Sheets, published as CSV, fetched client-side at page load (not build time) so updates appear without redeploying. URL is hardcoded (it's public, not a secret).
- **Offerings layout:** Four category cards (Weekly, Monthly, Big Events, Private Lessons) in a responsive grid. Items within each category are randomized on every page load.
- **Events calendar:** Google Calendar iframe embed. Month view on desktop (≥640px), Agenda view on mobile (<640px), switches dynamically on resize.
- **Google Calendar public access:** Calendar must be set to "Make available to public" → "See all event details" (not free/busy) or events won't appear to non-logged-in visitors.

## Notes

- The Google Calendar API / service-account setup is the fiddliest part of the stack. Stay on the iframe embed until there's a real reason to upgrade.
- One source of truth per data type: one calendar, one directory.
