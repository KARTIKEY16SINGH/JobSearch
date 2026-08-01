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
 * NOTE: because this environment has no live browser access, these
 * selectors were derived from a static fetch of jobs.apple.com's
 * server-rendered markup rather than verified end-to-end with Playwright.
 * Before relying on this scraper, run it once with HEADLESS=false and
 * `npx playwright codegen https://jobs.apple.com/en-us/search` side by
 * side to confirm/adjust the selectors below.
 */

export const AppleUrls = {
  base: "https://jobs.apple.com",

  /**
   * Builds a search results URL from a free-text role.
   *
   * Deliberately does NOT accept a location here. Apple's `location` query
   * param only accepts exact facet codes from its own location picker
   * (e.g. `india-INDC`, `new-delhi-NDS`, `united-states-USA`) — arbitrary
   * text like "India" doesn't get ignored, it matches zero jobs. Rather
   * than maintain a lookup table of every city/country code, location
   * filtering is applied client-side after scraping (see
   * `AppleCareersScraper` — it checks each job's displayed location
   * against `SearchCriteria.location` as a case-insensitive substring).
   */
  buildSearchUrl(role: string): string {
    const url = new URL("https://jobs.apple.com/en-us/search");
    url.searchParams.set("search", role);
    return url.toString();
  },
};

export const AppleSelectors = {
  /**
   * Search results page. Job titles render as links into
   * `/en-us/details/{roleNumber}/{slug}`, which is the most stable hook
   * on the page — used directly instead of relying on the surrounding
   * list/row markup.
   */
  search: {
    resultLinks: 'a[href*="/en-us/details/"]',
    resultsCount: 'text=/[0-9,]+\\+?\\s+Result/i',
    noResults: "text=/no results|0 results/i",
    /** Common "next page" affordances, tried in order until one matches. */
    nextPageCandidates: [
      'a[aria-label="Next"]',
      'button[aria-label="Next"]',
      'a:has-text("Next")',
      'button:has-text("Show More")',
      'button:has-text("Load More")',
    ],
  },

  /**
   * Job detail page (`/en-us/details/{roleNumber}/{slug}`).
   */
  detail: {
    title: "h1",
    /** e.g. "Role Number:  200675127-3337" */
    roleNumberLabel: 'text=/Role Number:/i',
    /** e.g. "Weekly Hours: 40 Hours" */
    weeklyHoursLabel: 'text=/Weekly Hours:/i',
    /** Location is usually shown near a "Location" label or heading. */
    location: 'text=/Location/i >> xpath=following-sibling::*[1]',
    locationFallback: '[class*="location" i]',
    /** Team / job family, e.g. "Software and Services". */
    team: '[class*="team" i], [class*="jobcategory" i]',
    description: 'main, [role="main"], article',
    postedDate: 'text=/Posted:|Updated:/i',
    applyButton: 'a:has-text("Submit Resume"), a:has-text("Apply Now"), button:has-text("Submit Resume")',
  },
};
