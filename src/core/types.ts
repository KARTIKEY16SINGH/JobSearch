/**
 * Domain types shared by every scraper and output writer.
 *
 * Keeping these in one place is what lets a new career-site scraper or a
 * new output target be added later without touching unrelated code: as
 * long as a scraper produces a `JobListing[]` and a writer consumes one,
 * the two sides never need to know about each other.
 */

/** Criteria supplied by the user (or, later, a saved search profile). */
export interface SearchCriteria {
  /** Free-text role/title to search for, e.g. "Sales Manager". */
  role: string;
  /** Optional location filter, e.g. "California" or "Remote". */
  location?: string;
  /** Optional extra keywords a scraper may use to refine/filter results. */
  keywords?: string[];
  /** Hard cap on the number of jobs to fully extract. Useful for testing. */
  maxResults?: number;
}

/**
 * Minimal information a scraper can read straight off a search results
 * page, before opening each job individually. Kept separate from
 * `JobListing` because listing pages rarely expose everything a job
 * detail page does.
 */
export interface JobListingSummary {
  /** Site-specific job identifier (e.g. Apple's "Role Number"). */
  id: string;
  title: string;
  /** Absolute URL of the job's detail page. */
  url: string;
  /** Location, if the search results page already shows it. */
  location?: string;
}

/** Fully extracted, structured job posting. */
export interface JobListing {
  id: string;
  title: string;
  location: string;
  team?: string;
  description: string;
  /** Posted/updated date exactly as shown on the site, if available. */
  postedDate?: string;
  applyUrl: string;
  /** URL of the job detail page the data was scraped from. */
  sourceUrl: string;
  /** Identifier of the scraper/site that produced this listing, e.g. "apple". */
  sourceSite: string;
  /** ISO-8601 timestamp of when this record was extracted. */
  scrapedAt: string;
}

/** A non-fatal problem encountered while scraping, kept for reporting. */
export interface ScrapeError {
  message: string;
  context?: string;
  timestamp: string;
}

/** Full result of running one scraper against one set of criteria. */
export interface ScrapeResult {
  siteName: string;
  criteria: SearchCriteria;
  jobs: JobListing[];
  errors: ScrapeError[];
  startedAt: string;
  finishedAt: string;
}

/** Metadata passed to output writers alongside the jobs to write. */
export interface WriteMeta {
  siteName: string;
  criteria: SearchCriteria;
  generatedAt: string;
}
