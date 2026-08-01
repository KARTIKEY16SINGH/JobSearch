import type { CareerSiteScraper } from "./base/career-site-scraper";

/**
 * Simple name -> scraper lookup. This is what makes "add a new career
 * site" a matter of writing one class and calling `register()` once in
 * `src/index.ts`, instead of threading new logic through the CLI,
 * orchestrator, and output layers.
 */
export class ScraperRegistry {
  private readonly scrapers = new Map<string, CareerSiteScraper>();

  register(scraper: CareerSiteScraper): void {
    if (this.scrapers.has(scraper.siteName)) {
      throw new Error(`A scraper for site "${scraper.siteName}" is already registered.`);
    }
    this.scrapers.set(scraper.siteName, scraper);
  }

  get(siteName: string): CareerSiteScraper {
    const scraper = this.scrapers.get(siteName);
    if (!scraper) {
      throw new Error(
        `No scraper registered for site "${siteName}". Available: ${this.listNames().join(", ") || "(none)"}`
      );
    }
    return scraper;
  }

  listNames(): string[] {
    return [...this.scrapers.keys()];
  }
}
