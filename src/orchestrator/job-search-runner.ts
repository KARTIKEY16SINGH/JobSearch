import type { BrowserContext } from "playwright";
import { Logger } from "../core/logger";
import type { JobListing, ScrapeError, ScrapeResult, SearchCriteria } from "../core/types";
import type { OutputWriter } from "../output/output-writer";
import type { ScraperRegistry } from "../scrapers/registry";

/**
 * Coordinates a single run: pick a scraper from the registry, search,
 * extract every matching job's details, then hand the results to each
 * configured output writer. This is the only place that knows about both
 * "scrapers" and "output writers" — neither layer knows about the other,
 * which is what keeps them independently extensible.
 */
export class JobSearchRunner {
  private readonly registry: ScraperRegistry;
  private readonly writers: OutputWriter[];
  private readonly logger: Logger;

  constructor(registry: ScraperRegistry, writers: OutputWriter[], logger: Logger = new Logger("job-search-runner")) {
    this.registry = registry;
    this.writers = writers;
    this.logger = logger;
  }

  async run(context: BrowserContext, siteName: string, criteria: SearchCriteria): Promise<ScrapeResult> {
    const startedAt = new Date().toISOString();
    const scraper = this.registry.get(siteName);
    const errors: ScrapeError[] = [];
    const jobs: JobListing[] = [];

    this.logger.info(`Starting search on "${siteName}" for role "${criteria.role}".`);
    const summaries = await scraper.search(context, criteria);
    this.logger.info(`Found ${summaries.length} candidate job(s). Extracting details...`);

    const locationFilter = criteria.location?.trim().toLowerCase();
    let skippedByLocation = 0;

    for (const [index, summary] of summaries.entries()) {
      if (criteria.maxResults && jobs.length >= criteria.maxResults) {
        this.logger.debug(`Reached maxResults (${criteria.maxResults}); stopping extraction.`);
        break;
      }

      try {
        const job = await scraper.extractJobDetails(context, summary);

        if (locationFilter && !job.location.toLowerCase().includes(locationFilter)) {
          skippedByLocation++;
          this.logger.debug(
            `(${index + 1}/${summaries.length}) Skipped "${job.title}" — location "${job.location}" doesn't match "${criteria.location}".`
          );
          continue;
        }

        jobs.push(job);
        this.logger.debug(`(${index + 1}/${summaries.length}) Extracted: ${job.title}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to extract job "${summary.title}" (${summary.url}): ${message}`);
        errors.push({ message, context: summary.url, timestamp: new Date().toISOString() });
      }
    }

    if (locationFilter && skippedByLocation > 0) {
      this.logger.info(`Filtered out ${skippedByLocation} job(s) not matching location "${criteria.location}".`);
    }

    const result: ScrapeResult = {
      siteName,
      criteria,
      jobs,
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    };

    await this.dispatchToWriters(jobs, result);
    return result;
  }

  private async dispatchToWriters(jobs: JobListing[], result: ScrapeResult): Promise<void> {
    const meta = {
      siteName: result.siteName,
      criteria: result.criteria,
      generatedAt: result.finishedAt,
    };

    for (const writer of this.writers) {
      try {
        await writer.write(jobs, meta);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Output writer "${writer.name}" failed: ${message}`);
        result.errors.push({ message, context: `writer:${writer.name}`, timestamp: new Date().toISOString() });
      }
    }
  }
}
