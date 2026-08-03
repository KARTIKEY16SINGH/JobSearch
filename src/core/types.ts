/**
 * Domain types shared by every scraper and output writer.
 *
 * Keeping these in one place is what lets a new career-site scraper or a
 * new output target be added later without touching unrelated code: as
 * long as a scraper produces a `JobListing[]` and a writer consumes one,
 * the two sides never need to know about each other.
 */

/**
 * Sentinel used by scrapers when a field genuinely couldn't be extracted
 * from the page. Kept as a shared constant (rather than each scraper
 * inventing its own string) so filters can tell "this value is known and
 * doesn't match" apart from "this value is unknown" — those must be
 * handled differently: an unknown value should never be silently treated
 * as a non-match.
 */
export const NOT_SPECIFIED = "Not specified";
/** @deprecated Use NOT_SPECIFIED — kept as an alias so existing imports don't break. */
export const UNKNOWN_LOCATION = NOT_SPECIFIED;

/** Criteria supplied by the user (or, later, a saved search profile). */
export interface SearchCriteria {
  /** Free-text role/title to search for, e.g. "Sales Manager". */
  role: string;
  /** Optional location filter, e.g. "California" or "Remote". */
  location?: string;
  /**
   * Optional cap on required years of experience. Jobs whose description
   * mentions a minimum experience requirement above this are filtered
   * out. Best-effort — see `core/experience.ts`.
   */
  maxYearsExperience?: number;
  /** Optional extra keywords a scraper may use to refine/filter results. */
  keywords?: string[];
  /** Hard cap on the number of jobs to fully extract. Useful for testing. */
  maxResults?: number;
  /**
   * Free-text extra filtering criteria the user wants applied, e.g. "must
   * offer hybrid or remote work", "prefer individual-contributor roles,
   * not people management". Only honored when AI-backed relevance
   * matching is active (`ai.provider` set in app.config.ts) — a plain
   * keyword matcher can't reasonably interpret free text. See
   * `orchestrator/relevance-matcher.ts`.
   */
  additionalCriteria?: string;
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
  /**
   * Work arrangement / employment type, e.g. "Full-time", "Part-time",
   * "Hybrid", "Remote" — whatever the site actually states. Defaults to
   * `NOT_SPECIFIED` when a scraper can't find this on the page.
   */
  employmentType: string;
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
