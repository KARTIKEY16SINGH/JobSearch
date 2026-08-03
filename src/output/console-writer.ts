import { toCompanyName } from "../core/format";
import type { JobListing, WriteMeta } from "../core/types";
import type { OutputWriter } from "./output-writer";

/**
 * Prints results to stdout, one labeled block per job, in the same
 * column order used by GoogleSheetsWriter — this is meant to be a
 * faithful preview of what would land in the sheet, not a separate
 * shorter summary. Full descriptions are printed in full (not
 * truncated), by design: this is a detail view, not a scan-quickly view.
 *
 * Has no dependency on the browser at all, which makes it the fastest
 * way to sanity-check a scraper while developing it.
 */
export class ConsoleWriter implements OutputWriter {
  readonly name = "console";

  async write(jobs: JobListing[], meta: WriteMeta): Promise<void> {
    console.log(`\n=== ${jobs.length} job(s) for "${meta.criteria.role}" on ${meta.siteName} ===\n`);

    jobs.forEach((job, index) => {
      const sNo = index + 1;
      console.log(`──────────────────────────────────────────────────────────`);
      console.log(`S.No.:            ${sNo}`);
      console.log(`Job ID:           ${job.id}`);
      console.log(`Company:          ${toCompanyName(job.sourceSite)}`);
      console.log(`Role Type:        ${job.team ?? "Not specified"}`);
      console.log(`Opening Heading:  ${job.title}`);
      console.log(`Location:         ${job.location}`);
      console.log(`Type:             ${job.employmentType}`);
      console.log(`Job Link:         ${job.sourceUrl}`);
      console.log(`Job Description:`);
      console.log(job.description || "(none extracted)");
      console.log("");
    });

    console.log(`──────────────────────────────────────────────────────────`);
    console.log(`Total: ${jobs.length} job(s)\n`);
  }
}
