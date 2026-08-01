import type { JobListing, WriteMeta } from "../core/types";

/**
 * Contract for anywhere scraped jobs can be sent. Like `CareerSiteScraper`,
 * this is an extensibility seam: a CSV writer, a database writer, or a
 * Notion writer can all be added later by implementing this one method,
 * without the orchestrator caring which writers are active.
 */
export interface OutputWriter {
  readonly name: string;
  write(jobs: JobListing[], meta: WriteMeta): Promise<void>;
}
