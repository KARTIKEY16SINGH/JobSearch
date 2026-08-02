import type { BrowserContext } from "playwright";
import { extractMinYearsExperience } from "../core/experience";
import { Logger } from "../core/logger";
import { UNKNOWN_LOCATION } from "../core/types";
import type { JobListing, ScrapeError, ScrapeResult, SearchCriteria } from "../core/types";
import type { OutputWriter } from "../output/output-writer";
import type { ScraperRegistry } from "../scrapers/registry";
import { KeywordRelevanceMatcher } from "./relevance-matcher";
import type { RelevanceMatcher } from "./relevance-matcher";

/**
 * Coordinates a single run: pick a scraper from the registry, search,
 * extract every candidate job's details, run relevance/location/
 * experience filtering, then hand the results to each configured output
 * writer.
 *
 * Extraction and filtering are deliberately two separate phases (extract
 * everything first, THEN filter) rather than interleaved. That's what
 * lets `RelevanceMatcher` batch every candidate into a single AI call
 * instead of one call per job — filtering needs the whole candidate set
 * up front to do that.
 */
export class JobSearchRunner {
  private readonly registry: ScraperRegistry;
  private readonly writers: OutputWriter[];
  private readonly relevanceMatcher: RelevanceMatcher;
  private readonly logger: Logger;

  constructor(
    registry: ScraperRegistry,
    writers: OutputWriter[],
    relevanceMatcher: RelevanceMatcher = new KeywordRelevanceMatcher(),
    logger: Logger = new Logger("job-search-runner")
  ) {
    this.registry = registry;
    this.writers = writers;
    this.relevanceMatcher = relevanceMatcher;
    this.logger = logger;
  }

  async run(context: BrowserContext, siteName: string, criteria: SearchCriteria): Promise<ScrapeResult> {
    const startedAt = new Date().toISOString();
    const scraper = this.registry.get(siteName);
    const errors: ScrapeError[] = [];

    this.logger.info(`Starting search on "${siteName}" for role "${criteria.role}".`);
    const summaries = await scraper.search(context, criteria);
    this.logger.info(`Found ${summaries.length} candidate job(s). Extracting details...`);

    // Phase 1: extract every candidate's full details.
    const extracted: JobListing[] = [];
    for (const [index, summary] of summaries.entries()) {
      try {
        const job = await scraper.extractJobDetails(context, summary);
        extracted.push(job);
        this.logger.debug(`(${index + 1}/${summaries.length}) Extracted: ${job.title}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to extract job "${summary.title}" (${summary.url}): ${message}`);
        errors.push({ message, context: summary.url, timestamp: new Date().toISOString() });
      }
    }

    // Phase 2: relevance filtering (batched — one call for AI matchers).
    this.logger.info(`Checking relevance of ${extracted.length} extracted job(s) using "${this.relevanceMatcher.name}"...`);
    const relevant = await this.relevanceMatcher.filterRelevant(criteria.role, extracted);
    const skippedByRelevance = extracted.length - relevant.length;
    if (skippedByRelevance > 0) {
      this.logger.info(
        `Filtered out ${skippedByRelevance} job(s) that didn't appear related to "${criteria.role}" ` +
          `(the site's own search included them anyway).`
      );
    }

    // Phase 3: location + experience filtering, then truncate to maxResults.
    const locationFilter = criteria.location?.trim().toLowerCase();
    const jobs: JobListing[] = [];
    let skippedByLocation = 0;
    let unknownLocationCount = 0;
    let skippedByExperience = 0;
    let unknownExperienceCount = 0;

    for (const job of relevant) {
      if (criteria.maxResults && jobs.length >= criteria.maxResults) {
        this.logger.debug(`Reached maxResults (${criteria.maxResults}); stopping.`);
        break;
      }

      // A location that couldn't be determined is NOT the same as a
      // location that doesn't match — filtering it out would silently
      // drop jobs we simply failed to read, which is worse than
      // occasionally including one we couldn't verify.
      if (locationFilter && job.location !== UNKNOWN_LOCATION) {
        if (!job.location.toLowerCase().includes(locationFilter)) {
          skippedByLocation++;
          this.logger.debug(
            `Skipped "${job.title}" — location "${job.location}" doesn't match "${criteria.location}".`
          );
          continue;
        }
      } else if (locationFilter && job.location === UNKNOWN_LOCATION) {
        unknownLocationCount++;
      }

      // Same fail-open logic for experience: only filter out a job when
      // we found an actual number and it exceeds the cap.
      if (criteria.maxYearsExperience !== undefined) {
        const minYears = extractMinYearsExperience(job.description);
        if (minYears === undefined) {
          unknownExperienceCount++;
        } else if (minYears > criteria.maxYearsExperience) {
          skippedByExperience++;
          this.logger.debug(
            `Skipped "${job.title}" — requires ${minYears}+ years, above the ${criteria.maxYearsExperience} cap.`
          );
          continue;
        }
      }

      jobs.push(job);
    }

    if (locationFilter && skippedByLocation > 0) {
      this.logger.info(`Filtered out ${skippedByLocation} job(s) not matching location "${criteria.location}".`);
    }
    if (locationFilter && unknownLocationCount > 0) {
      this.logger.warn(
        `${unknownLocationCount} job(s) had no extractable location and were kept rather than filtered — ` +
          `check them manually, and consider fixing scrapers/apple/selectors.ts if this count is high.`
      );
    }
    if (criteria.maxYearsExperience !== undefined && skippedByExperience > 0) {
      this.logger.info(
        `Filtered out ${skippedByExperience} job(s) requiring more than ${criteria.maxYearsExperience} years of experience.`
      );
    }
    if (criteria.maxYearsExperience !== undefined && unknownExperienceCount > 0) {
      this.logger.warn(
        `${unknownExperienceCount} job(s) had no detectable experience requirement and were kept rather ` +
          `than filtered — experience parsing is best-effort text matching, not guaranteed.`
      );
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
