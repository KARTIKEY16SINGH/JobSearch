/**
 * All Apple Careers (jobs.apple.com) DOM knowledge lives in this file.
 *
 * jobs.apple.com is a client-rendered single-page app, and career sites in
 * general restyle/rebuild their DOM without notice. Rather than scatter
 * CSS selectors through the scraper's control flow, they're centralized
 * here so that when Apple changes their markup, this is the only file
 * that needs updating.
 *
 * Selector strategy: prefer attributes/structure that are unlikely to be
 * pure styling hooks (URL patterns, semantic text like "Role Number:")
 * over auto-generated class names, which tend to be the first thing that
 * changes.
 *
 * NOTE: because this environment has no live browser access, the search
 * results page's `resultLinks`/`noResults` selectors were derived from a
 * static fetch of jobs.apple.com's markup rather than verified end-to-end
 * with Playwright. Everything else — the search input, pagination
 * (`nextPageCandidates`/`totalPages`), and every selector under `detail`
 * (location, team, minimum qualifications) — IS confirmed against real
 * rendered DOM. If jobs are found but nothing gets extracted or "no
 * results" misfires, `resultLinks`/`noResults` are the remaining
 * suspects — run once with `headless: false` in `app.config.ts` and
 * `npx playwright codegen https://jobs.apple.com/en-us/search` side by
 * side to confirm/adjust.
 */

export const AppleUrls = {
  base: "https://jobs.apple.com",

  /**
   * Builds the Careers search page URL for a given locale, with no query
   * string.
   *
   * Search is deliberately NOT done by navigating straight to
   * `?search=<role>`. That looked like it should work — the URL format is
   * real, Apple's own listing pages use it — but a cold direct load of
   * that URL does not reliably return the same results as typing the
   * same text into the on-page search box and submitting it. This is a
   * common failure mode for client-rendered SPAs: the app's own search
   * flow updates internal state via its search form/JS, and a hard
   * navigation to a URL with the same query string doesn't always
   * hydrate into the same state. So instead, `AppleCareersScraper` loads
   * this plain landing page and drives the real search box, the same way
   * a person would.
   *
   * `locale` is the URL path segment Apple uses per region, e.g. "en-us",
   * "en-in", "en-gb" — pass `{ locale: "en-in" }` to `AppleCareersScraper`
   * to search a different one; it defaults to "en-us".
   */
  searchPageUrl(locale: string): string {
    return `https://jobs.apple.com/${locale}/search`;
  },
};

export const AppleSelectors = {
  /**
   * Search results page. Job titles render as links into
   * `/{locale}/details/{roleNumber}/{slug}` — e.g. `/en-us/details/...` or
   * `/en-in/details/...` depending on which locale's search page you're
   * on (see `AppleUrls.searchPageUrl`). The selector below matches on
   * `/details/` only, deliberately without a locale segment, so it keeps
   * working regardless of which locale URL is configured.
   */
  search: {
    /**
     * The free-text search box on the search page — confirmed from the
     * real DOM (a typeahead/combobox: `aria-autocomplete="list"`,
     * `aria-controls="suggestions-list"`, class `search-typeahead-input`).
     * There is no separate submit button in this component; submitting
     * the typed text is done via Enter on the input itself, handled in
     * `performSearch`.
     */
    searchInputCandidates: [
      "input.search-typeahead-input",
      'input[aria-label="Search by role or keyword"]',
      'input[aria-label*="search" i]',
      'input[placeholder*="search" i]',
      'input[type="search"]',
      "#search",
    ],
    /**
     * Fallback only — this typeahead component doesn't expose a separate
     * submit button as of the last DOM check; Enter on the input is the
     * real submission path. Kept in case a future redesign adds one.
     */
    searchSubmitCandidates: [
      'button[aria-label*="search" i]',
      'button:has-text("Search")',
      'button[type="submit"]',
    ],
    resultLinks: 'a[href*="/details/"]',
    resultsCount: 'text=/[0-9,]+\\+?\\s+Result/i',
    noResults: "text=/no results|0 results/i",
    /**
     * "Next page" control — confirmed from the real DOM: a
     * `<nav class="rc-pagination">` containing a page-number input and
     * prev/next buttons. The real button's `aria-label` is "Next Page",
     * NOT "Next" — an earlier version of this selector guessed "Next"
     * (an exact-attribute match), which silently never matched and made
     * every search stop after page 1. `button[aria-label="Next Page"]` is
     * the confirmed primary selector; the rest are defensive fallbacks in
     * case of a future redesign.
     */
    nextPageCandidates: [
      'button[aria-label="Next Page"]',
      'button[data-analytics-pagination="next"]',
      "nav.rc-pagination button.icon-chevronend",
      'a[aria-label="Next"]',
      'button[aria-label="Next"]',
    ],
    /** Total page count, e.g. the "2" in "Page [1] Of [2]" — confirmed from real DOM. Used only for a friendlier progress log. */
    totalPages: '[data-autom="paginationTotalPages"]',
  },

  /**
   * Job detail page (`/{locale}/details/{roleNumber}/{slug}`). These are
   * confirmed against the real DOM (unlike the search page selectors
   * above, which still aren't).
   */
  detail: {
    title: "h1",
    /**
     * Location renders two different ways depending on whether the role
     * is open in one place or several:
     * - Single location: `<label id="jobdetails-joblocation">City, State,
     *   Country</label>`
     * - Multiple locations: a `<select id="job-details-locationDropdown">`
     *   whose `<option>` elements each have a `label` attribute with one
     *   full location string, e.g. "Bengaluru, Karnataka, India".
     * `extractLocation` in the scraper tries the multi-location dropdown
     * first (joining every option), then falls back to the single label.
     */
    location: {
      singleLabel: "#jobdetails-joblocation",
      multiSelect: "#job-details-locationDropdown",
      multiOptions: "#job-details-locationDropdown option",
    },
    /** Team / job family, e.g. "Corporate Functions". */
    team: "#jobdetails-teamname",
    description: 'main, [role="main"], article',
    /**
     * The "Minimum Qualifications" bullet list — this is where years-of-
     * experience requirements actually live, e.g. "6+ years of relevant
     * experience in...". Used for `core/experience.ts` parsing so that
     * regex isn't run over the whole page (unrelated numbers elsewhere on
     * the page could otherwise produce false matches).
     */
    minimumQualifications: "#jobdetails-minimumqualifications",
    postedDate: 'text=/Posted:|Updated:/i',
    applyButton: 'a:has-text("Submit Resume"), a:has-text("Apply Now"), button:has-text("Submit Resume")',
  },
};
