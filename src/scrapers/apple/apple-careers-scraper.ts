import type { BrowserContext, Locator, Page } from "playwright";
import { AbstractCareerSiteScraper } from "../base/career-site-scraper";
import type { JobListing, JobListingSummary, SearchCriteria } from "../../core/types";
import { withRetry } from "../../core/retry";
import { AppleSelectors, AppleUrls } from "./selectors";

export interface AppleCareersScraperOptions {
  /** Safety cap on pagination even if the caller didn't set maxResults. */
  maxPages?: number;
}

/**
 * CareerSiteScraper implementation for jobs.apple.com.
 *
 * See `selectors.ts` for all DOM-coupled details — this file only
 * contains control flow, so a future selector fix never touches logic
 * like pagination or retry behaviour.
 */
export class AppleCareersScraper extends AbstractCareerSiteScraper {
  readonly siteName = "apple";
  private readonly maxPages: number;

  constructor(options: AppleCareersScraperOptions = {}) {
    super();
    this.maxPages = options.maxPages ?? 5;
  }

  async search(context: BrowserContext, criteria: SearchCriteria): Promise<JobListingSummary[]> {
    const page = await this.openPage(context);
    const summaries: JobListingSummary[] = [];
    const seenUrls = new Set<string>();

    try {
      this.logger.info(`Searching Apple Careers for "${criteria.role}" via the on-page search box.`);

      await withRetry(() => page.goto(AppleUrls.searchPageUrl, { waitUntil: "domcontentloaded" }), {
        logger: this.logger,
        label: "apple.search.goto",
      });

      await this.performSearch(page, criteria.role);

      // The results page renders client-side, so submitting the search
      // doesn't guarantee results (or a no-results message) are visible
      // yet. Wait for whichever shows up first before deciding anything.
      await Promise.race([
        page.locator(AppleSelectors.search.resultLinks).first().waitFor({ state: "attached", timeout: 15_000 }),
        page.locator(AppleSelectors.search.noResults).first().waitFor({ state: "visible", timeout: 15_000 }),
      ]).catch(() => {
        this.logger.warn(
          "Neither job results nor a no-results message appeared within 15s. The selectors in " +
            "scrapers/apple/selectors.ts likely need updating for the current site markup."
        );
      });

      const noResults = await page.locator(AppleSelectors.search.noResults).count();
      if (noResults > 0) {
        this.logger.info(`No results for "${criteria.role}".`);
        return [];
      }

      for (let pageIndex = 0; pageIndex < this.maxPages; pageIndex++) {
        const newOnThisPage = await this.collectResultLinks(page, summaries, seenUrls);
        this.logger.debug(`Page ${pageIndex + 1}: collected ${newOnThisPage} new job(s).`);

        const shouldTruncateHere = criteria.maxResults && !criteria.location;
        if (shouldTruncateHere && summaries.length >= criteria.maxResults!) {
          return summaries.slice(0, criteria.maxResults);
        }

        const advanced = await this.goToNextPage(page);
        if (!advanced) break;
      }

      const shouldTruncateAtEnd = criteria.maxResults && !criteria.location;
      return shouldTruncateAtEnd ? summaries.slice(0, criteria.maxResults) : summaries;
    } finally {
      await page.close();
    }
  }

  async extractJobDetails(context: BrowserContext, summary: JobListingSummary): Promise<JobListing> {
    const page = await this.openPage(context);
    try {
      await withRetry(() => page.goto(summary.url, { waitUntil: "domcontentloaded" }), {
        logger: this.logger,
        label: `apple.detail.goto(${summary.id})`,
      });

      const title = (await this.safeText(page, AppleSelectors.detail.title)) ?? summary.title;
      const location =
        (await this.extractLocation(page)) ?? summary.location ?? "Not specified";
      const team = await this.extractTeam(page);
      const description = (await this.safeText(page, AppleSelectors.detail.description)) ?? "";
      const postedDate = await this.extractPostedDate(page);
      const applyUrl =
        (await this.safeAttribute(page, AppleSelectors.detail.applyButton, "href")) ?? page.url();

      const listing: JobListing = {
        id: summary.id,
        title,
        location,
        ...(team ? { team } : {}),
        description,
        ...(postedDate ? { postedDate } : {}),
        applyUrl: this.toAbsoluteUrl(applyUrl),
        sourceUrl: page.url(),
        sourceSite: this.siteName,
        scrapedAt: new Date().toISOString(),
      };

      return listing;
    } finally {
      await page.close();
    }
  }

  /**
   * Types the role into Apple's on-page search box and submits it,
   * mirroring what a person does — see the comment on
   * `AppleUrls.searchPageUrl` for why this replaced a `?search=` URL.
   */
  private async performSearch(page: Page, role: string): Promise<void> {
    const input = await this.findFirstVisible(page, AppleSelectors.search.searchInputCandidates);
    if (!input) {
      throw new Error(
        "Could not find the search input box on the Apple Careers page. The selectors in " +
          "scrapers/apple/selectors.ts (search.searchInputCandidates) likely need updating for " +
          "the current site markup."
      );
    }

    await input.click();
    await input.fill(""); // clear any stale value first
    await input.pressSequentially(role, { delay: 60 });

    // This is a live typeahead (aria-autocomplete="list") that debounces a
    // suggestions lookup as you type. Give that a moment to settle before
    // submitting, so Enter reliably submits the free-text query instead of
    // racing an in-flight request.
    await page.waitForTimeout(500);

    const urlBeforeSubmit = page.url();
    await input.press("Enter");

    // Give the SPA a moment to apply the search. Prefer detecting an
    // actual URL/network change; fall back to a short fixed wait if the
    // site doesn't update the URL for a client-side search.
    const navigated = await page
      .waitForURL((url) => url.toString() !== urlBeforeSubmit, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!navigated) {
      const submitButton = await this.findFirstVisible(page, AppleSelectors.search.searchSubmitCandidates);
      if (submitButton) {
        await submitButton.click().catch(() => {});
      }
    }

    await page.waitForLoadState("networkidle").catch(() => {});
  }

  /** Returns the first selector (in order) that matches a currently visible element, or null. */
  private async findFirstVisible(page: Page, candidates: string[]): Promise<Locator | null> {
    for (const selector of candidates) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
        return locator;
      }
    }
    return null;
  }

  /** Extracts job links from the current results page and appends new ones to `summaries`. */
  private async collectResultLinks(
    page: Page,
    summaries: JobListingSummary[],
    seenUrls: Set<string>
  ): Promise<number> {
    const links = page.locator(AppleSelectors.search.resultLinks);
    const count = await links.count();
    let added = 0;

    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const href = await link.getAttribute("href");
      if (!href) continue;

      const absoluteUrl = this.toAbsoluteUrl(href.split("?")[0] ?? href);
      if (seenUrls.has(absoluteUrl)) continue;
      seenUrls.add(absoluteUrl);

      const title = (await link.innerText()).trim();
      const id = this.extractRoleNumberFromUrl(absoluteUrl) ?? absoluteUrl;

      summaries.push({ id, title, url: absoluteUrl });
      added++;
    }

    return added;
  }

  /** Tries known "next page" affordances; returns false when none advance the page. */
  private async goToNextPage(page: Page): Promise<boolean> {
    for (const candidate of AppleSelectors.search.nextPageCandidates) {
      const locator = page.locator(candidate).first();
      if ((await locator.count()) === 0) continue;

      const isDisabled = await locator.isDisabled().catch(() => false);
      if (isDisabled) continue;

      try {
        await locator.click({ timeout: 5000 });
        await page.waitForLoadState("domcontentloaded");
        return true;
      } catch {
        // Try the next candidate selector.
        continue;
      }
    }
    return false;
  }

  private async extractLocation(page: Page): Promise<string | undefined> {
    return (
      (await this.safeText(page, AppleSelectors.detail.location)) ??
      (await this.safeText(page, AppleSelectors.detail.locationFallback))
    );
  }

  private async extractTeam(page: Page): Promise<string | undefined> {
    return this.safeText(page, AppleSelectors.detail.team);
  }

  private async extractPostedDate(page: Page): Promise<string | undefined> {
    const raw = await this.safeText(page, AppleSelectors.detail.postedDate);
    if (!raw) return undefined;
    const match = raw.match(/(Posted|Updated):\s*(.+)/i);
    return match?.[2]?.trim() ?? raw;
  }

  private extractRoleNumberFromUrl(url: string): string | undefined {
    const match = url.match(/\/details\/([^/]+)\//);
    return match?.[1];
  }

  private toAbsoluteUrl(url: string): string {
    return url.startsWith("http") ? url : new URL(url, AppleUrls.base).toString();
  }
}
