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
 *
 * Each phase prints a clear banner + live per-item progress via
 * `logger.banner()`/`logger.progress()` (plain, untagged output) — a run
 * over 20+ jobs can take a minute or more with real page loads, and a
 * silent terminal during that time looks indistinguishable from a hang.
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
    const runStart = Date.now();
    const scraper = this.registry.get(siteName);
    const errors: ScrapeError[] = [];

    // --- Step 1: search --------------------------------------------------
    this.logger.banner(`STEP 1: Searching ${siteName} for "${criteria.role}"`);
    const summaries = await scraper.search(context, criteria);
    this.logger.progress(`Found ${summaries.length} candidate job(s).`);

    // --- Step 2: extract every candidate's full details -------------------
    this.logger.banner(`STEP 2: Extracting job details (${summaries.length} candidate(s))`);
    const extracted: JobListing[] = [];
    for (const [index, summary] of summaries.entries()) {
      this.logger.progress(`[${index + 1}/${summaries.length}] Extracting: ${summary.title}`);
      try {
        const job = await scraper.extractJobDetails(context, summary);
        extracted.push(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.progress(`  → failed: ${message}`);
        errors.push({ message, context: summary.url, timestamp: new Date().toISOString() });
      }
    }
    this.logger.progress(
      `Extraction complete — ${extracted.length}/${summaries.length} succeeded, ${errors.length} failed.`
    );

    // --- Step 3: relevance filtering (batched — one call for AI matchers) -
    this.logger.banner(`STEP 3: Checking relevance (matcher: ${this.relevanceMatcher.name})`);
    if (this.relevanceMatcher.name === "keyword" && criteria.additionalCriteria) {
      this.logger.warn(
        `"${criteria.additionalCriteria}" was supplied as extra filter criteria, but the keyword matcher ` +
          `can't interpret free text — it'll be ignored this run. Set ai.provider in app.config.ts to have ` +
          `an AI matcher actually apply it.`
      );
    }
    this.logger.progress(`Checking ${extracted.length} job(s) against "${criteria.role}"...`);
    const relevant = await this.relevanceMatcher.filterRelevant(criteria, extracted);
    const skippedByRelevance = extracted.length - relevant.length;
    this.logger.progress(`Relevance check complete — kept ${relevant.length}, filtered out ${skippedByRelevance}.`);

    // --- Step 4: location + experience filtering, then truncate ----------
    this.logger.banner("STEP 4: Applying location & experience filters");
    this.logger.progress(`Location filter: ${criteria.location ?? "(none)"}`);
    this.logger.progress(
      `Experience filter: ${criteria.maxYearsExperience !== undefined ? `≤ ${criteria.maxYearsExperience} years` : "(none)"}`
    );
    if (criteria.maxYearsExperience !== undefined) {
      this.logger.progress(
        `  (This is a deterministic backstop applied to every job regardless of matcher — it looks for an ` +
          `explicit "N years" mention in the description via regex. It fails OPEN: a job with no explicit ` +
          `number stated is kept, not dropped, since we can't assume it's over the cap. If the AI matcher is ` +
          `active, it already weighed the experience cap using title/seniority cues too — see STEP 3 above.)`
      );
    }

    const locationFilter = criteria.location?.trim().toLowerCase();
    const jobs: JobListing[] = [];
    let skippedByLocation = 0;
    let unknownLocationCount = 0;
    let skippedByExperience = 0;
    let unknownExperienceCount = 0;

    for (const job of relevant) {
      if (criteria.maxResults && jobs.length >= criteria.maxResults) {
        this.logger.progress(`Reached the ${criteria.maxResults}-job limit; stopping here.`);
        break;
      }

      // A location that couldn't be determined is NOT the same as a
      // location that doesn't match — filtering it out would silently
      // drop jobs we simply failed to read, which is worse than
      // occasionally including one we couldn't verify.
      if (locationFilter && job.location !== UNKNOWN_LOCATION) {
        if (!job.location.toLowerCase().includes(locationFilter)) {
          skippedByLocation++;
          this.logger.progress(`  ↳ "${job.title}": location "${job.location}" — FILTERED (doesn't match "${criteria.location}").`);
          continue;
        }
      } else if (locationFilter && job.location === UNKNOWN_LOCATION) {
        unknownLocationCount++;
        this.logger.progress(`  ↳ "${job.title}": location unknown — kept (couldn't verify).`);
      }

      // Same fail-open logic for experience: only filter out a job when
      // we found an actual number and it exceeds the cap.
      if (criteria.maxYearsExperience !== undefined) {
        const minYears = extractMinYearsExperience(job.description);
        if (minYears === undefined) {
          unknownExperienceCount++;
          this.logger.progress(`  ↳ "${job.title}": experience not stated in description — kept (couldn't verify).`);
        } else if (minYears > criteria.maxYearsExperience) {
          skippedByExperience++;
          this.logger.progress(
            `  ↳ "${job.title}": requires ${minYears}+ years — FILTERED (exceeds ${criteria.maxYearsExperience}-year cap).`
          );
          continue;
        } else {
          this.logger.progress(`  ↳ "${job.title}": requires ${minYears}+ years — OK (within ${criteria.maxYearsExperience}-year cap).`);
        }
      }

      jobs.push(job);
    }

    this.logger.progress(`\nKept ${jobs.length} job(s) after filtering.`);
    if (locationFilter && skippedByLocation > 0) {
      this.logger.progress(`  - ${skippedByLocation} skipped: location didn't match "${criteria.location}".`);
    }
    if (locationFilter && unknownLocationCount > 0) {
      this.logger.warn(
        `${unknownLocationCount} job(s) had no extractable location and were kept rather than filtered — ` +
          `check them manually, and consider fixing scrapers/apple/selectors.ts if this count is high.`
      );
    }
    if (criteria.maxYearsExperience !== undefined && skippedByExperience > 0) {
      this.logger.progress(
        `  - ${skippedByExperience} skipped: required more than ${criteria.maxYearsExperience} years of experience.`
      );
    }
    if (criteria.maxYearsExperience !== undefined && unknownExperienceCount > 0) {
      this.logger.warn(
        `${unknownExperienceCount} job(s) had no detectable experience requirement and were kept rather ` +
          `than filtered — experience parsing is best-effort text matching, not guaranteed. If the AI matcher ` +
          `is active, that step already applied its own judgment to these; if using the keyword matcher, ` +
          `these numbers are entirely unverified for experience.`
      );
    }

    // --- Step 5: write output ---------------------------------------------
    this.logger.banner(`STEP 5: Writing output (${this.writers.map((w) => w.name).join(", ")})`);

    const finishedAt = new Date().toISOString();
    const result: ScrapeResult = { siteName, criteria, jobs, errors, startedAt, finishedAt };

    await this.dispatchToWriters(jobs, result);

    const elapsedSeconds = ((Date.now() - runStart) / 1000).toFixed(1);
    this.logger.banner(`DONE — ${jobs.length} job(s) in ${elapsedSeconds}s (${errors.length} error(s))`);

    return result;
  }

  private async dispatchToWriters(jobs: JobListing[], result: ScrapeResult): Promise<void> {
    const meta = {
      siteName: result.siteName,
      criteria: result.criteria,
      generatedAt: result.finishedAt,
    };

    for (const writer of this.writers) {
      this.logger.progress(`Writing via "${writer.name}"...`);
      try {
        await writer.write(jobs, meta);
        this.logger.progress(`  → done.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Output writer "${writer.name}" failed: ${message}`);
        result.errors.push({ message, context: `writer:${writer.name}`, timestamp: new Date().toISOString() });
      }
    }
  }
}
