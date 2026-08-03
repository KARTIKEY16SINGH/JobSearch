import type { BrowserContext, Locator, Page } from "playwright";
import { AbstractCareerSiteScraper } from "../base/career-site-scraper";
import type { JobListing, JobListingSummary, SearchCriteria } from "../../core/types";
import { UNKNOWN_LOCATION } from "../../core/types";
import { withRetry } from "../../core/retry";
import { AppleSelectors, AppleUrls } from "./selectors";

export interface AppleCareersScraperOptions {
  /** Safety cap on pagination even if the caller didn't set maxResults. */
  maxPages?: number;
  /**
   * Apple locale path segment, e.g. "en-us", "en-in", "en-gb". Controls
   * which localized search page is loaded (`https://jobs.apple.com/{locale}/search`).
   * Defaults to "en-us".
   */
  locale?: string;
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
  private readonly searchPageUrl: string;

  constructor(options: AppleCareersScraperOptions = {}) {
    super();
    this.maxPages = options.maxPages ?? 5;
    this.searchPageUrl = AppleUrls.searchPageUrl(options.locale ?? "en-us");
  }

  async search(context: BrowserContext, criteria: SearchCriteria): Promise<JobListingSummary[]> {
    const page = await this.openPage(context);
    const summaries: JobListingSummary[] = [];
    const seenUrls = new Set<string>();

    try {
      this.logger.progress(`Opening Apple Careers search page (${this.searchPageUrl})...`);

      await withRetry(() => page.goto(this.searchPageUrl, { waitUntil: "domcontentloaded" }), {
        logger: this.logger,
        label: "apple.search.goto",
      });

      this.logger.progress(`Typing "${criteria.role}" into the search box...`);
      await this.performSearch(page, criteria.role);

      this.logger.progress("Search submitted, waiting for results to load...");

      // The results page renders client-side, so submitting the search
      // doesn't guarantee results are visible yet. Wait for at least one
      // job link to attach before deciding anything.
      await page
        .locator(AppleSelectors.search.resultLinks)
        .first()
        .waitFor({ state: "attached", timeout: 15_000 })
        .catch(() => {
          // Might genuinely be zero results, or the page just hasn't
          // rendered yet — the count check right below tells us which.
        });

      const resultCount = await page.locator(AppleSelectors.search.resultLinks).count();
      if (resultCount === 0) {
        const noResultsMessageShown = (await page.locator(AppleSelectors.search.noResults).count()) > 0;
        this.logger.progress(
          `No job links found for "${criteria.role}".` +
            (noResultsMessageShown
              ? ""
              : " No explicit no-results message was found either — if jobs are visibly showing " +
                "in the browser, search.resultLinks in scrapers/apple/selectors.ts needs updating " +
                "for the current site markup.")
        );
        return [];
      }

      for (let pageIndex = 0; pageIndex < this.maxPages; pageIndex++) {
        const newOnThisPage = await this.collectResultLinks(page, summaries, seenUrls);
        const totalPagesText = await this.safeText(page, AppleSelectors.search.totalPages);
        const pageLabel = totalPagesText ? `Page ${pageIndex + 1} of ${totalPagesText}` : `Page ${pageIndex + 1}`;
        this.logger.progress(`${pageLabel}: found ${newOnThisPage} new job(s) (${summaries.length} total so far).`);

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
      const location = (await this.extractLocation(page)) ?? summary.location ?? UNKNOWN_LOCATION;
      const team = await this.extractTeam(page);
      const employmentType = this.extractEmploymentTypeFromTitle(title) ?? UNKNOWN_LOCATION;
      const description = (await this.safeText(page, AppleSelectors.detail.description)) ?? "";
      const postedDate = await this.extractPostedDate(page);
      const applyUrl =
        (await this.safeAttribute(page, AppleSelectors.detail.applyButton, "href")) ?? page.url();

      const listing: JobListing = {
        id: summary.id,
        title,
        location,
        ...(team ? { team } : {}),
        employmentType,
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
      if (!this.isJobDetailUrl(absoluteUrl)) {
        this.logger.warn(`Ignoring non-job link returned by the results selector: ${absoluteUrl}`);
        continue;
      }
      if (seenUrls.has(absoluteUrl)) continue;
      seenUrls.add(absoluteUrl);

      const title = (await link.innerText()).trim();
      if (!title) {
        this.logger.warn(`Ignoring a job detail link with no title: ${absoluteUrl}`);
        continue;
      }
      const id = this.extractRoleNumberFromUrl(absoluteUrl) ?? absoluteUrl;

      summaries.push({ id, title, url: absoluteUrl });
      added++;
    }

    return added;
  }

  /**
   * Apple role detail pages use `/{locale}/details/{role-number}/{slug}`.
   * Keep this validation separate from the CSS selector: a future page
   * redesign can make a selector broader again, but it must never turn an
   * informational link into a job to open and extract.
   */
  private isJobDetailUrl(url: string): boolean {
    try {
      return /^\/[a-z]{2}-[a-z]{2}\/details\/\d+(?:-\d+)?\/[^/?#]+$/i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  /** Tries known "next page" affordances; returns false when none advance the page. */
  private async goToNextPage(page: Page): Promise<boolean> {
    for (const candidate of AppleSelectors.search.nextPageCandidates) {
      const locator = page.locator(candidate).first();
      const matchCount = await locator.count();
      if (matchCount === 0) continue;

      const isDisabled = await locator.isDisabled().catch(() => false);
      if (isDisabled) {
        this.logger.progress(`  ↳ Pagination control "${candidate}" found but disabled — trying next candidate.`);
        continue;
      }

      // Captured before clicking so we can confirm the results actually
      // changed afterward — see the comment below on why that check
      // matters.
      const resultLinkSelector = AppleSelectors.search.resultLinks;
      const firstLinkBefore = await page
        .locator(resultLinkSelector)
        .first()
        .getAttribute("href")
        .catch(() => null);

      try {
        await locator.click({ timeout: 5000 });
        await page.waitForLoadState("domcontentloaded");

        // Clicking "Next Page" triggers a client-side re-render (an XHR/
        // fetch under the hood), not a full page navigation, so
        // domcontentloaded above resolves almost immediately — often
        // BEFORE the new page's jobs have actually replaced the old
        // ones in the DOM. Scraping right then silently re-collects the
        // previous page's links (which look like "0 new jobs" once
        // dedup kicks in) instead of the next page's real content.
        // Waiting for the first result link's href to actually change
        // confirms the swap has happened before we read the page.
        //
        // The callback below runs inside the browser page, not in Node —
        // `document` is a real global there even though the Node-only
        // tsconfig `lib` doesn't declare it. Casting through `globalThis`
        // keeps the rest of the project on Node-only types instead of
        // pulling in the whole DOM lib just for this one call.
        const changed = await page
          .waitForFunction(
            ({ selector, prevHref }) => {
              const doc = (globalThis as any).document;
              const link = doc.querySelector(selector);
              return !!link && link.getAttribute("href") !== prevHref;
            },
            { selector: resultLinkSelector, prevHref: firstLinkBefore },
            { timeout: 10_000 }
          )
          .then(() => true)
          .catch(() => false);

        if (!changed) {
          this.logger.progress(
            `  ↳ Clicked "${candidate}" but the results list didn't appear to change within 10s — ` +
              "the next page's contents may be stale/duplicated."
          );
        }

        this.logger.progress(`  ↳ Advanced to next page via "${candidate}".`);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.progress(`  ↳ Pagination control "${candidate}" matched but click failed: ${message}`);
        continue;
      }
    }

    this.logger.progress(
      "  ↳ No pagination control matched any known selector — stopping after this page. " +
        "If more results actually exist, search.nextPageCandidates in scrapers/apple/selectors.ts " +
        "needs the real control's selector (never verified against live DOM — see selectors.ts header)."
    );
    return false;
  }

  /**
   * Handles the two real location layouts on Apple's detail page: a
   * `<select>` dropdown listing every office for roles open in multiple
   * locations, or a single `<label>` for roles open in just one.
   */
  private async extractLocation(page: Page): Promise<string | undefined> {
    const options = page.locator(AppleSelectors.detail.location.multiOptions);
    const optionCount = await options.count();

    if (optionCount > 0) {
      const labels: string[] = [];
      for (let i = 0; i < optionCount; i++) {
        const option = options.nth(i);
        const label = (await option.getAttribute("label")) ?? (await option.innerText());
        const trimmed = label?.trim();
        if (trimmed) labels.push(trimmed);
      }
      if (labels.length > 0) return labels.join("; ");
    }

    return this.safeText(page, AppleSelectors.detail.location.singleLabel);
  }

  private async extractTeam(page: Page): Promise<string | undefined> {
    return this.safeText(page, AppleSelectors.detail.team);
  }

  /**
   * Best-effort only: Apple's detail page doesn't have a confirmed,
   * dedicated "employment type" field as of the last DOM check (unlike
   * location/team, which do). Some titles include a hint like
   * "US - Specialist: Seasonal, Part-time" — this catches that pattern,
   * but most titles won't mention it at all, so this will often fall
   * back to NOT_SPECIFIED. If you find where this actually lives on the
   * page (e.g. near "Weekly Hours"), share that DOM and this can be
   * fixed properly instead of guessing from title text.
   */
  private extractEmploymentTypeFromTitle(title: string): string | undefined {
    const patterns: Array<[RegExp, string]> = [
      [/\bpart[- ]?time\b/i, "Part-time"],
      [/\bfull[- ]?time\b/i, "Full-time"],
      [/\bseasonal\b/i, "Seasonal"],
      [/\bintern(ship)?\b/i, "Internship"],
      [/\bcontract(or)?\b/i, "Contract"],
      [/\bremote\b/i, "Remote"],
      [/\bhybrid\b/i, "Hybrid"],
    ];
    for (const [pattern, label] of patterns) {
      if (pattern.test(title)) return label;
    }
    return undefined;
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
