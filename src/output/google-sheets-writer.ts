import type { BrowserContext, Page } from "playwright";
import type { GoogleSheetsConfig } from "../config/load-config";
import { Logger } from "../core/logger";
import type { JobListing, WriteMeta } from "../core/types";
import type { OutputWriter } from "./output-writer";

const COLUMNS: Array<{ header: string; value: (job: JobListing) => string }> = [
  { header: "Job ID", value: (j) => j.id },
  { header: "Title", value: (j) => j.title },
  { header: "Location", value: (j) => j.location },
  { header: "Team", value: (j) => j.team ?? "" },
  { header: "Posted Date", value: (j) => j.postedDate ?? "" },
  { header: "Description", value: (j) => j.description },
  { header: "Apply URL", value: (j) => j.applyUrl },
  { header: "Source URL", value: (j) => j.sourceUrl },
  { header: "Source Site", value: (j) => j.sourceSite },
  { header: "Scraped At", value: (j) => j.scrapedAt },
];

/**
 * Writes jobs into a Google Sheet by driving the real Sheets UI with
 * Playwright, reusing the same persistent `BrowserContext` the scraper
 * used — per the project requirement, this deliberately avoids the
 * Google Sheets API. Login is handled by the persistent profile: the
 * first time you run this with `headless: false` in `app.config.ts`,
 * sign into Google normally in the opened tab; the session cookie is
 * then reused on every subsequent run (see README for details).
 *
 * Mechanism: select the target cell via Sheets' "Name box", write the
 * job data to the OS clipboard as tab-separated values, and paste —
 * exactly what a person would do to bulk-enter data, and something
 * Sheets already knows how to lay out across rows/columns correctly.
 */
export class GoogleSheetsWriter implements OutputWriter {
  readonly name = "google-sheets";
  private readonly context: BrowserContext;
  private readonly config: GoogleSheetsConfig;
  private readonly logger: Logger;

  constructor(context: BrowserContext, config: GoogleSheetsConfig, logger: Logger = new Logger("google-sheets-writer")) {
    if (!config.sheetUrl) {
      throw new Error("GoogleSheetsWriter requires GOOGLE_SHEET_URL to be set.");
    }
    this.context = context;
    this.config = config;
    this.logger = logger;
  }

  async write(jobs: JobListing[], meta: WriteMeta): Promise<void> {
    if (jobs.length === 0) {
      this.logger.info("No jobs to write to Google Sheets — skipping.");
      return;
    }

    const page = await this.context.newPage();
    try {
      this.logger.info(`Opening spreadsheet: ${this.config.sheetUrl}`);
      await page.goto(this.config.sheetUrl, { waitUntil: "domcontentloaded" });

      await this.assertLoggedIn(page);

      if (this.config.sheetTab) {
        await this.switchToTab(page, this.config.sheetTab);
      }

      const rows = this.buildRows(jobs);
      await this.pasteAt(page, this.config.startCell, rows);

      this.logger.info(
        `Wrote ${jobs.length} job(s) for "${meta.criteria.role}" to Google Sheets starting at ${this.config.startCell}.`
      );
    } finally {
      await page.close();
    }
  }

  private async assertLoggedIn(page: Page): Promise<void> {
    const onGoogleLogin = page.url().includes("accounts.google.com");
    const signInVisible = await page
      .getByRole("link", { name: /sign in/i })
      .first()
      .isVisible()
      .catch(() => false);

    if (onGoogleLogin || signInVisible) {
      throw new Error(
        "Google Sheets is not logged in on this browser profile. Set headless: false in " +
          "src/config/app.config.ts, run the app once, sign into Google manually in the window " +
          "that opens, then set headless back to whatever you like — the login is stored in " +
          "the userDataDir folder from app.config.ts."
      );
    }

    // Give the Sheets editor UI a moment to finish loading its canvas.
    await page.waitForSelector('[aria-label="Name box"], #t-name-box', { timeout: 20_000 });
  }

  private async switchToTab(page: Page, tabName: string): Promise<void> {
    const tab = page.getByRole("tab", { name: tabName }).first();
    if ((await tab.count()) === 0) {
      this.logger.warn(`Sheet tab "${tabName}" not found; writing to the currently active tab.`);
      return;
    }
    await tab.click();
  }

  private buildRows(jobs: JobListing[]): string[][] {
    const header = COLUMNS.map((c) => c.header);
    const dataRows = jobs.map((job) => COLUMNS.map((c) => this.sanitizeCell(c.value(job))));
    return [header, ...dataRows];
  }

  /** Tabs/newlines inside a value would otherwise be misread as cell/row separators on paste. */
  private sanitizeCell(value: string): string {
    return value.replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
  }

  private async pasteAt(page: Page, startCell: string, rows: string[][]): Promise<void> {
    const nameBox = page.locator('[aria-label="Name box"], #t-name-box').first();
    await nameBox.click();
    await nameBox.fill(startCell);
    await page.keyboard.press("Enter");

    const tsv = rows.map((row) => row.join("\t")).join("\n");
    // This callback runs inside the browser page, not in Node — `navigator`
    // is a real global there even though the Node-only `tsconfig.json`
    // `lib` doesn't declare it. Casting through `globalThis` keeps the
    // rest of the project on Node-only types instead of pulling in the
    // whole DOM lib just for this one call.
    await page.evaluate(async (text: string) => {
      await (globalThis as any).navigator.clipboard.writeText(text);
    }, tsv);

    const pasteShortcut = process.platform === "darwin" ? "Meta+V" : "Control+V";
    await page.keyboard.press(pasteShortcut);

    // Sheets applies large pastes asynchronously; give it a moment before
    // the tab is closed.
    await page.waitForTimeout(1500);
  }
}
