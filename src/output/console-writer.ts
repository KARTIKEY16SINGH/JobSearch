import type { JobListing, WriteMeta } from "../core/types";
import type { OutputWriter } from "./output-writer";

/**
 * Prints results to stdout. This has no dependency on the browser at all,
 * which makes it the fastest way to sanity-check a scraper while
 * developing it, before wiring up Google Sheets.
 */
export class ConsoleWriter implements OutputWriter {
  readonly name = "console";

  async write(jobs: JobListing[], meta: WriteMeta): Promise<void> {
    console.log(
      `\n=== ${jobs.length} job(s) for "${meta.criteria.role}" on ${meta.siteName} ===\n`
    );

    for (const job of jobs) {
      console.log(`- [${job.id}] ${job.title}`);
      console.log(`    Location: ${job.location}`);
      if (job.team) console.log(`    Team: ${job.team}`);
      if (job.postedDate) console.log(`    Posted: ${job.postedDate}`);
      console.log(`    Apply: ${job.applyUrl}`);
      console.log("");
    }
  }
}
