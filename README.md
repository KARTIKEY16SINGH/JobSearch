# Job Search Automation

A local, Playwright-based framework that scrapes company career sites and
writes matching jobs into a Google Sheet, driving the Sheets UI directly
through a persistent, logged-in browser profile — no Google Sheets API,
no service account.

This first version implements one site (Apple Careers) but the framework
is built so that adding the next one is a matter of writing one class, not
restructuring the project.

## Architecture

```
src/
  core/                  Shared, site-agnostic building blocks
    types.ts             JobListing, SearchCriteria, ScrapeResult, ...
    browser-manager.ts   Owns the single persistent BrowserContext
    logger.ts            Small leveled logger
    retry.ts             Retry-with-backoff helper for flaky page loads

  scrapers/
    base/career-site-scraper.ts   CareerSiteScraper interface + shared helpers
    registry.ts                  siteName -> scraper lookup
    apple/
      apple-careers-scraper.ts   Control flow (search, paginate, extract)
      selectors.ts                All Apple DOM/CSS knowledge, isolated

  output/
    output-writer.ts             OutputWriter interface
    console-writer.ts            Prints results to stdout
    google-sheets-writer.ts      Pastes results into a Google Sheet via the UI

  orchestrator/
    job-search-runner.ts         Runs one scraper end-to-end, fans out to writers

  config/
    app.config.ts         Every setting you'd want to change — edit this
    load-config.ts        Shapes app.config.ts into a typed AppConfig
  cli/args.ts              Minimal --flag argument parsing
  index.ts                  Wires everything together
```

### Why it's split this way

- **`CareerSiteScraper` is the only thing the orchestrator knows about a
  site.** Adding Google, LinkedIn, or any other company's careers page
  later means writing a new class that implements `search()` and
  `extractJobDetails()` and registering it in `src/index.ts`. Nothing in
  `orchestrator/`, `output/`, or `cli/` needs to change.
- **`OutputWriter` is the only thing the orchestrator knows about a
  destination.** A CSV writer, a database writer, or a Notion writer can
  be added the same way, independent of which scrapers exist.
- **Apple's DOM knowledge lives entirely in `scrapers/apple/selectors.ts`.**
  Career sites restyle their markup without warning; when that happens,
  this is the only file that needs editing — `apple-careers-scraper.ts`
  only contains control flow (pagination, retries, field fallbacks).
- **One `BrowserManager` owns one persistent `BrowserContext`** for the
  whole run, and that context is passed into both the scraper and the
  `GoogleSheetsWriter`. That's what makes "same browser session, persistent
  logged-in profile" concrete: one cookie jar, reused across runs via
  `USER_DATA_DIR`.

## Setup

```bash
npm install
npx playwright install chromium   # if postinstall didn't already do this
```

All settings live in one plain file: `src/config/app.config.ts`. Open it
and edit the values directly — no `.env`, no environment variables:

```ts
export const appConfig = {
  headless: false,
  userDataDir: "./.browser-profile",
  defaultTimeoutMs: 30000,
  apple: {
    locale: "en-in", // "en-us", "en-gb", etc.
  },
  googleSheets: {
    sheetUrl: "https://docs.google.com/spreadsheets/d/<your-sheet-id>/edit",
    sheetTab: "Jobs",
    startCell: "A1",
  },
};
```

Leave `googleSheets.sheetUrl` as `""` if you just want console output for
now.

### First run: log into Google once

`GoogleSheetsWriter` reuses whatever Google session already exists in the
persistent profile — it never handles credentials itself. The first time
you want to write to Sheets:

1. Keep `headless: false` in `app.config.ts`.
2. Run the app with `--output sheets` (see below).
3. A visible Chromium window opens the target sheet. If it lands on a
   Google sign-in page, log in manually in that window.
4. The session is saved to the `userDataDir` folder and reused on every
   future run — headless or not — until the session expires or you
   delete that folder.

## Usage

### Interactive (default)

Running with no `--role` flag drops you into a guided prompt for role,
site, location, result cap, and output destination:

```bash
npm run dev
```

```
Job Search Automation — interactive setup
(press Enter to accept the default shown in [brackets])

Role to search for (e.g. "Sales Manager"): Sales Manager
Career site to search: apple
Choice [apple]:
Location filter (blank = any):
Max number of jobs to fully open and extract (blank = no limit): 10
Where should results go?
  1) console
  2) sheets
  3) console,sheets
Choice [1]: 3

Ready:
  Role:     Sales Manager
  Site:     apple
  Location: (any)
  Max jobs: 10
  Output:   console, sheets

Start the search? [Y/n]:
```

The Google Sheets option is only offered when `googleSheets.sheetUrl` is
set in `app.config.ts`.

### Flags (non-interactive / scriptable)

Passing `--role` skips the prompts entirely, so the tool can be scripted
or cron'd:

```bash
npm run dev -- --role "Sales Manager"
npm run dev -- --role "Sales Manager" --max 10
npm run dev -- --role "Sales Manager" --output sheets
npm run dev -- --role "Sales Manager" --output console,sheets
npm run dev -- --role "Sales Manager" --location "California"
```

Any flag you omit still gets its usual default (e.g. `--site` defaults to
`apple`, `--output` defaults to `console`) rather than being prompted for.
Add `--interactive` to be prompted for every field even when some flags
were already given — useful for double-checking before a run.

Or build and run compiled JS:

```bash
npm run build
npm start -- --role "Sales Manager" --output sheets
```

## Known limitation: Apple's selectors need live verification

jobs.apple.com is a client-rendered single-page app. The selectors in
`src/scrapers/apple/selectors.ts` were derived from a static fetch of the
site's markup, not verified end-to-end in a running browser (this was
built in an environment without live browser access). Before relying on
this scraper:

```bash
npm run dev -- --role "Sales Manager" --max 3
```

with `headless: false` in `app.config.ts`, watch it run, and compare
against `npx playwright codegen https://jobs.apple.com/en-us/search` if
any field comes back empty. All DOM-specific fixes belong in
`selectors.ts` only — you should not need to touch
`apple-careers-scraper.ts`.

The scraper is written to degrade field-by-field rather than fail a whole
job: if e.g. "team" isn't found, that job is still returned with the other
fields populated and `team` omitted.

## How search actually works

The role/keyword search is driven through Apple's real on-page search box
— the scraper loads the plain locale search page (default
`https://jobs.apple.com/en-us/search`, see "Locales" below), types the
role into the search input, and submits it, rather than navigating
straight to `?search=<role>`. A cold direct load of that URL turned out
not to reliably return the same results as typing the same text into the
box: a common failure mode for client-rendered SPAs, where the app's
search flow updates internal state via its own form/JS and a hard
navigation to the "same" URL doesn't always hydrate into that state. If
the search box's selector ever needs adjusting, it's
`search.searchInputCandidates` in `selectors.ts`.

Job detail links are matched on `/details/` only (not `/en-us/details/`)
so this keeps working across locales — see "Locales" below for why that
distinction matters.

## Locales

Set `apple.locale` in `src/config/app.config.ts` (this repo currently
ships with it set to `en-in`) to search a different regional Careers
site, e.g. `en-us` for the US, `en-gb` for the UK. This controls which
`jobs.apple.com/<locale>/search` page gets loaded.

One thing that bit an earlier version of this scraper: job detail links
are locale-prefixed (`/en-in/details/...`, not always `/en-us/details/...`),
so `search.resultLinks` in `selectors.ts` deliberately matches on
`/details/` alone — if you ever see it re-narrowed to a specific locale
prefix, that will silently return zero jobs on every other locale.

## How the location filter works

Apple's own `location` URL parameter only accepts exact facet codes from
its location picker (e.g. `india-INDC`, `new-delhi-NDS`), not free text —
sending `location=India` doesn't get ignored, it matches zero jobs, which
looks exactly like "the scraper is broken" from the outside.

To sidestep needing a lookup table of every city/country code, `--location`
is applied as a client-side filter instead: the search only ever uses
`search=<role>`, and after each job's detail page is scraped, its
displayed location is checked as a case-insensitive substring match
against what you typed (`"India"` matches `"Various Locations within
India"`, `"Hyderabad"`, etc.). This means a location filter can end up
opening more detail pages than `--max` alone would, since jobs are only
counted toward `--max` after they pass the location check — that's
expected, not a bug.

Also worth knowing: Apple's own search box does exact keyword matching,
not fuzzy/substring matching — searching `"Sale"` won't reliably surface
`"Sales"` roles the way a human eye would. Use the full word you're after
(`"Sales"`, `"Sales Manager"`) for best results.

## Extending: adding a new career site

1. Create `src/scrapers/<company>/selectors.ts` with that site's URLs/CSS.
2. Create `src/scrapers/<company>/<company>-careers-scraper.ts` extending
   `AbstractCareerSiteScraper` (see `apple-careers-scraper.ts` as a
   reference) and implement `search()` / `extractJobDetails()`.
3. Register it in `src/index.ts`:
   ```ts
   registry.register(new YourCompanyScraper());
   ```
4. Run it: `npm run dev -- --role "..." --site yourcompany`

## Extending: adding a new output

Implement `OutputWriter` (`write(jobs, meta)`) in `src/output/`, then wire
it up in `src/index.ts` wherever writers are selected from `--output`.

## Roadmap (not implemented yet)

- User-configurable, saved search profiles (multiple criteria sets)
- AI-based relevance/matching scoring on top of raw scraped listings
- Additional output targets (CSV, database)
- Additional career-site scrapers
