import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { toCompanyName } from "../core/format";
import { Logger } from "../core/logger";
import type { JobListing, WriteMeta } from "../core/types";
import type { OutputWriter } from "./output-writer";

const HEADERS = [
  "S.No.",
  "Job Id",
  "Company",
  "Role Type",
  "Opening Heading",
  "Location Available",
  "Type",
  "Job Description",
  "Job Link",
];

/**
 * Appends shortlisted jobs to a CSV file. The file is never rewritten when
 * it already exists, so earlier jobs and any user-added rows remain intact.
 */
export class CsvWriter implements OutputWriter {
  readonly name = "csv";
  private readonly filePath: string;
  private readonly logger: Logger;

  constructor(filePath: string, logger: Logger = new Logger("csv-writer")) {
    this.filePath = filePath;
    this.logger = logger;
  }

  async write(jobs: JobListing[], meta: WriteMeta): Promise<void> {
    if (jobs.length === 0) {
      this.logger.info("No jobs to write to CSV — skipping.");
      return;
    }

    const existingFile = await this.getExistingFile();
    const startNumber = existingFile.rowCount + 1;
    const rows = jobs.map((job, index) => [String(startNumber + index), ...this.toRow(job)]);
    const data = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n") + "\n";
    const prefix = existingFile.isEmpty ? `${HEADERS.map(escapeCsvCell).join(",")}\n` : existingFile.endsWithNewline ? "" : "\n";

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, prefix + data, "utf8");

    this.logger.info(
      `Appended ${jobs.length} shortlisted job(s) for "${meta.criteria.role}" to ${this.filePath}.`
    );
  }

  private async getExistingFile(): Promise<{ isEmpty: boolean; endsWithNewline: boolean; rowCount: number }> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { isEmpty: true, endsWithNewline: true, rowCount: 0 };
      }
      throw error;
    }

    if (!content.trim()) return { isEmpty: true, endsWithNewline: true, rowCount: 0 };
    // The header is one row. Parse rather than count physical lines because
    // a job description may legitimately include a line break inside quotes.
    const rowCount = Math.max(0, parseCsv(content).length - 1);
    return { isEmpty: false, endsWithNewline: /\r?\n$/.test(content), rowCount };
  }

  private toRow(job: JobListing): string[] {
    return [
      job.id,
      toCompanyName(job.sourceSite),
      job.team ?? "Not specified",
      job.title,
      job.location,
      job.employmentType,
      job.description,
      job.sourceUrl,
    ];
  }

}

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Parses quoted CSV well enough to count existing records with multiline descriptions. */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index++) {
    const character = content[index]!;
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
