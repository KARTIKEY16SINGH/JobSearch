import type { BrowserContext, Page } from "playwright";
import { Logger } from "../../core/logger";
import type { JobListing, JobListingSummary, SearchCriteria } from "../../core/types";

/**
 * Contract every company career-site scraper must implement.
 *
 * This is the extensibility seam for the whole project: adding support for
 * a new company means writing one new class that implements this
 * interface and registering it (see `scrapers/registry.ts`). Nothing else
 * in the framework — the orchestrator, the CLI, the output writers — needs
 * to change.
 *
 * The two-phase shape (search → summaries, then extractJobDetails per
 * summary) mirrors how career sites actually work: a search results page
 * gives you a list of links, and each job's full detail lives on its own
 * page. Splitting it this way also lets the orchestrator cap how many
 * detail pages it opens (`SearchCriteria.maxResults`) without the scraper
 * needing to know about that policy.
 */
export interface CareerSiteScraper {
  /** Stable, unique identifier for this site, e.g. "apple". Used in logs,
   *  CLI --site selection, and JobListing.sourceSite. */
  readonly siteName: string;

  /** Runs a search and returns lightweight summaries of matching jobs. */
  search(context: BrowserContext, criteria: SearchCriteria): Promise<JobListingSummary[]>;

  /** Opens a single job's detail page and extracts full structured data. */
  extractJobDetails(context: BrowserContext, summary: JobListingSummary): Promise<JobListing>;
}

/**
 * Optional base class concrete scrapers can extend for shared plumbing
 * (logging, safe text extraction, page lifecycle). Implementing
 * `CareerSiteScraper` directly is also fine — this just removes
 * boilerplate that would otherwise be duplicated per site.
 */
export abstract class AbstractCareerSiteScraper implements CareerSiteScraper {
  abstract readonly siteName: string;
  protected readonly logger: Logger;

  constructor() {
    this.logger = new Logger(`scraper:${this.constructor.name}`);
  }

  abstract search(context: BrowserContext, criteria: SearchCriteria): Promise<JobListingSummary[]>;
  abstract extractJobDetails(context: BrowserContext, summary: JobListingSummary): Promise<JobListing>;

  /** Opens a fresh tab, always cleaned up via the caller's try/finally. */
  protected async openPage(context: BrowserContext): Promise<Page> {
    return context.newPage();
  }

  /**
   * Reads text from the first element matching `selector`, returning
   * `undefined` instead of throwing if it isn't found. Career site DOMs
   * change often; scrapers should degrade gracefully field-by-field
   * rather than fail an entire job extraction over one missing element.
   */
  protected async safeText(page: Page, selector: string): Promise<string | undefined> {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) return undefined;
      const text = await locator.innerText();
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Same as `safeText` but reads an attribute instead of inner text. */
  protected async safeAttribute(
    page: Page,
    selector: string,
    attribute: string
  ): Promise<string | undefined> {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) return undefined;
      const value = await locator.getAttribute(attribute);
      return value?.trim() || undefined;
    } catch {
      return undefined;
    }
  }
}
