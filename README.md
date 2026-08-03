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
    relevance-matcher.ts         RelevanceMatcher interface: keyword (default) + AI (batched)

  ai/
    ai-provider.ts               The one interface every AI backend implements
    providers/
      openai-provider.ts         ChatGPT adapter
      gemini-provider.ts         Gemini adapter

  config/
    app.config.ts         Every setting you'd want to change — edit this
    secrets.local.ts      API keys only (gitignored) — copy from secrets.local.example.ts
    load-config.ts        Shapes app.config.ts + secrets.local.ts into a typed AppConfig
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
    csv: {
      filePath: "./output/shortlisted-jobs.csv",
    },
};
```

Leave `googleSheets.sheetUrl` as `""` if you just want console output for
now.

### First run: log into Google once

`GoogleSheetsWriter` reuses whatever Google session already exists in the
persistent profile — it never handles credentials itself. The first time
you want to write to Sheets:

1. Keep `headless: false` in `app.config.ts` — **this matters**: headless
   mode has no visible window for you to log into, so if it detects
   you're not logged in while headless, it fails immediately with an
   explanation instead of hanging or silently doing nothing.
2. Run the app with `--output sheets` (see below).
3. A visible Chromium window opens the target sheet. If it lands on a
   Google sign-in page, the terminal will pause and print:
   ```
   Google Sheets isn't logged in on this browser profile.
   A browser window should be open on the sign-in page — log in there now.
   Press Enter here once you're logged in and can see the spreadsheet...
   ```
   Log in in the window, then come back and press Enter in the terminal —
   the run continues from there rather than failing.
4. The session is saved to the `userDataDir` folder and reused on every
   future run — headless or not — until the session expires or you
   delete that folder. Once logged in once, you can switch back to
   `headless: true` for future runs.

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
npm run dev -- --role "Sales Manager" --output csv
npm run dev -- --role "Sales Manager" --output console,csv
npm run dev -- --role "Sales Manager" --location "California"
npm run dev -- --role "Sales Manager" --max-experience 7
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

### CSV output

Use `--output csv` to save shortlisted jobs locally without opening Google
Sheets. The default destination is `output/shortlisted-jobs.csv`; change
`csv.filePath` in `src/config/app.config.ts` to use another file. Repeated
runs append new jobs and leave all existing rows unchanged.

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

One more thing: if the location filter ever seems to be dropping jobs
that clearly do match, check the logs for a line like `"N job(s) had no
extractable location and were kept rather than filtered"` — a location
that couldn't be read from the page is deliberately NOT treated as a
non-match (that would silently and incorrectly drop real matches whenever
extraction has a hiccup). It's kept and flagged instead, so worth a
manual glance.

## How the relevance filter works

Career sites' own search isn't always as strict as it looks — Apple's has
returned jobs with no obvious connection to what was searched (e.g.
searching "Sale" and getting a "Software Engineer: Data & AI" listing
back). Rather than trust a site's result set blindly, every job is
double-checked in `core/relevance.ts`: at least one meaningful word from
the searched role has to appear in the job's **title or team name**, or
it's dropped. Short/common words ("of", "the", "in"...) are ignored so
this doesn't over-filter on filler words in a role like "Manager of
Sales".

Deliberately scoped to title + team, not the full description — job
descriptions routinely mention unrelated departments in passing
boilerplate ("works closely with sales, marketing, and engineering"),
which made an earlier version of this check pass almost everything
through.

This runs automatically for every search — no flag needed — and is
site-agnostic, so it applies the same way if another scraper is added
later.

## Using AI for relevance matching instead of keywords

The keyword filter above is fast and free, but it's pattern matching, not
understanding — it can't tell that "Business Development Representative"
is a sales role without the word "sales" appearing anywhere. For that you
need real judgment, which is what the AI-backed matcher is for.

**Setup:**

1. `npm install` — the Gemini adapter uses Google's official `@google/genai`
   SDK, added as a dependency (the OpenAI adapter still uses plain
   `fetch`, no SDK needed there).
2. Copy `src/config/secrets.local.example.ts` to `src/config/secrets.local.ts`
   (already gitignored) and fill in whichever key you're using:
   ```ts
   export const secrets = {
     openaiApiKey: "sk-...",   // from platform.openai.com/api-keys
     geminiApiKey: "",         // from aistudio.google.com/apikey — starts with "AIzaSy"
   };
   ```
3. In `src/config/app.config.ts`, set:
   ```ts
   ai: {
     provider: "openai",   // or "gemini", or "none" to go back to keyword matching
     ...
   }
   ```

Run the app as usual — no other code changes needed.

**How it works:** after every candidate job's detail page is scraped,
every one of them (title + team, not the full description — same
boilerplate-noise reason as the keyword filter) is sent to the configured
AI provider in a **single batched call** — not one call per job — asking
it to return which ones are genuinely relevant. This is why extraction
happens in full before any filtering starts, rather than interleaved
job-by-job like the keyword matcher can be.

**Adapter architecture, for swapping or adding providers:** every AI
backend implements one interface, `AiProvider` in `src/ai/ai-provider.ts`
— a single `complete(prompt): Promise<string>` method. `gemini-provider.ts`
wraps Google's official `@google/genai` SDK; `openai-provider.ts` calls
the REST API directly with `fetch` (no SDK needed for a single-endpoint
call like that one). Either style works — the interface only cares that
`complete()` returns text. Nothing in `relevance-matcher.ts` or
`job-search-runner.ts` knows which provider is active; switching is a
one-line config change, not a code change. Adding a third provider
(Claude, a local model, anything else) means writing one more small
adapter file and adding one branch to `buildRelevanceMatcher` in
`index.ts` — nothing else changes.

**Reliability:** any failure — missing key, network error, rate limit, a
response that doesn't parse as the expected JSON, or one that somehow
matches zero candidates — automatically falls back to the free keyword
matcher for that run, logged as a warning. An AI outage should never turn
into zero results.

**Worth knowing before turning this on:**
- Unlike everything else in this project, this needs a real, paid API key
  from your own OpenAI or Google account — separate from any ChatGPT/
  Gemini subscription, billed per their API pricing.
- Adds one network round-trip per search (a second or two), and a small
  per-run cost — the keyword matcher is instant and free.
- Results can vary slightly between identical runs on borderline cases —
  it's a judgment call, not a deterministic rule.

## How the experience filter works

`--max-experience <n>` (or the interactive prompt) applies in up to two
layers depending on whether AI matching is on:

1. **Deterministic backstop (always runs, any matcher):** looks for an
   explicit "N years" mention in the description via regex, in
   `src/core/experience.ts` — job postings phrase this inconsistently
   ("6+ years of relevant experience", "3-5 years experience", "minimum
   of 2 years professional experience"), so it's best-effort text
   matching, not a guarantee. If a posting lists more than one qualifying
   path (e.g. "6+ years experience, or a Master's degree with 2 years"),
   the smallest number is used. If no number is found at all, the job is
   **kept, not dropped** (fails open, like the location filter) — a job
   with an unstated requirement isn't the same as one that violates the
   cap. The run logs each job's outcome and why.
2. **AI judgment (only when `ai.provider` is set):** the same extracted
   number is sent to the AI as a hint alongside title/team, and the AI is
   told the cap directly and asked to also use judgment about seniority
   cues in the title (e.g. "Senior", "Lead", "Director" usually implies
   more years even when none is explicitly stated) — see the next
   section. This is what actually fixed jobs like a "Field Engineering
   Lead" role (explicitly stating "10+ years") slipping through when only
   the keyword matcher's blind regex pass was being relied on.

## Adding custom filter criteria (AI matching only)

Beyond role/location/experience, you can hand the AI matcher free-text
criteria to weigh — `--criteria "<text>"`, or just answer the interactive
prompt for it. Examples: `"prefer hybrid or remote roles"`, `"avoid
people-management titles"`, `"only individual-contributor roles"`.

This is only honored when `ai.provider` is set to `"openai"` or
`"gemini"` in `app.config.ts` — the keyword matcher can't reasonably
interpret free text, so if you supply this with AI matching off, the run
logs a warning that it's being ignored rather than silently dropping it.

## Output columns

Both `ConsoleWriter` and `GoogleSheetsWriter` use the same column set and
order, so the terminal output is always a faithful preview of what lands
in the sheet: `S.No.`, `Job Id`, `Company`, `Role Type` (the job's team),
`Opening Heading` (title), `Location Available`, `Type` (employment
type), `Job Description`, `Job Link`.

`Type` (Full-time/Part-time/Remote/Hybrid/etc.) is best-effort only —
Apple's detail page doesn't have a confirmed dedicated field for this
(unlike location/team, which do), so it's inferred from patterns in the
job title and falls back to "Not specified" when nothing matches. If you
find where this actually lives on the page, share that DOM and it can be
fixed properly instead of guessing from title text.

## A pagination note

Clicking "Next Page" on Apple's results is a client-side re-render, not a
full page navigation — the scraper waits for the first result link's
`href` to actually change before reading the new page, rather than just
waiting for the click to register, since the latter was scraping the
still-stale previous page's content (showing up as "0 new jobs found" on
page 2+ even when more results existed).

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

## Extending: adding a new AI provider

1. Create `src/ai/providers/<name>-provider.ts` implementing `AiProvider`
   (`src/ai/ai-provider.ts`) — one method, `complete(prompt): Promise<string>`.
   Use `openai-provider.ts` or `gemini-provider.ts` as a reference; most of
   it is just that provider's request/response shape.
2. Add the matching key to `secrets.local.ts` / `secrets.local.example.ts`
   and a model setting to `app.config.ts`'s `ai` section.
3. Add one branch to `buildRelevanceMatcher()` in `src/index.ts`.

Nothing in `relevance-matcher.ts` or `job-search-runner.ts` needs to
change — they only ever see the `AiProvider`/`RelevanceMatcher`
interfaces.

## Roadmap (not implemented yet)

- User-configurable, saved search profiles (multiple criteria sets)
- Additional output targets (CSV, database)
- Additional career-site scrapers
