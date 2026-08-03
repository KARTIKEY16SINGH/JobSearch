import * as readline from "node:readline/promises";
import type { BrowserContext, Page } from "playwright";
import type { GoogleSheetsConfig } from "../config/load-config";
import { toCompanyName } from "../core/format";
import { Logger } from "../core/logger";
import type { JobListing, WriteMeta } from "../core/types";
import type { OutputWriter } from "./output-writer";

/**
 * Column order matches ConsoleWriter's per-job breakdown exactly, so the
 * terminal preview and the sheet always show the same thing. S.No. isn't
 * in this list — it's the row index, added separately in `buildRows`.
 */
const COLUMNS: Array<{ header: string; value: (job: JobListing) => string }> = [
  { header: "Job Id", value: (j) => j.id },
  { header: "Company", value: (j) => toCompanyName(j.sourceSite) },
  { header: "Role Type", value: (j) => j.team ?? "Not specified" },
  { header: "Opening Heading", value: (j) => j.title },
  { header: "Location Available", value: (j) => j.location },
  { header: "Type", value: (j) => j.employmentType },
  { header: "Job Description", value: (j) => j.description },
  { header: "Job Link", value: (j) => j.sourceUrl },
];

/**
 * Writes jobs into a Google Sheet by driving the real Sheets UI with
 * Playwright, reusing the same persistent `BrowserContext` the scraper
 * used — per the project requirement, this deliberately avoids the
 * Google Sheets API. Login is handled by the persistent profile.
 *
 * Two distinct not-logged-in behaviors, based on `headless`:
 * - **Headless**: fails immediately with a clear explanation — there's
 *   no visible window for a human to log into, so waiting would just
 *   hang forever for no reason. Tells you exactly what to change.
 * - **Headed**: pauses and asks in the terminal — "log in in the window
 *   that just opened, then press Enter here" — instead of failing
 *   immediately, since a person genuinely can act on it right now.
 *
 * Either way, once logged in, the session is saved in the persistent
 * profile (`userDataDir` in app.config.ts) and reused on every future
 * run — headless or not — until it expires.
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
  private readonly headless: boolean;
  private readonly logger: Logger;

  constructor(
    context: BrowserContext,
    config: GoogleSheetsConfig,
    headless: boolean,
    logger: Logger = new Logger("google-sheets-writer")
  ) {
    if (!config.sheetUrl) {
      throw new Error("GoogleSheetsWriter requires googleSheets.sheetUrl to be set in app.config.ts.");
    }
    this.context = context;
    this.config = config;
    this.headless = headless;
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

      await this.ensureLoggedIn(page);

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

  private async isLoggedOut(page: Page): Promise<boolean> {
    const onGoogleLogin = page.url().includes("accounts.google.com");
    const signInVisible = await page
      .getByRole("link", { name: /sign in/i })
      .first()
      .isVisible()
      .catch(() => false);
    return onGoogleLogin || signInVisible;
  }

  private async ensureLoggedIn(page: Page): Promise<void> {
    if (!(await this.isLoggedOut(page))) {
      await this.waitForSheetsToLoad(page);
      return;
    }

    if (this.headless) {
      throw new Error(
        "Google Sheets is not logged in on this browser profile, and the browser is running " +
          "headless (headless: true in app.config.ts) — there's no visible window for you to log " +
          "in. Set headless: false in app.config.ts, run once, log in when the window opens, then " +
          "switch back to headless: true for future runs — the session is saved in the userDataDir " +
          "folder and reused automatically."
      );
    }

    // Headed: give the person a real chance to log in right now instead
    // of failing immediately.
    this.logger.progress("");
    this.logger.progress("──────────────────────────────────────────────────────────");
    this.logger.progress("Google Sheets isn't logged in on this browser profile.");
    this.logger.progress("A browser window should be open on the sign-in page — log in there now.");
    this.logger.progress("──────────────────────────────────────────────────────────");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      await rl.question("Press Enter here once you're logged in and can see the spreadsheet... ");
    } finally {
      rl.close();
    }

    // Login may have redirected away from the sheet — go back to it.
    if (page.url().includes("accounts.google.com")) {
      await page.goto(this.config.sheetUrl, { waitUntil: "domcontentloaded" });
    }

    if (await this.isLoggedOut(page)) {
      throw new Error(
        "Still not logged in to Google after waiting. Run the app again once you've finished " +
          "signing in — the session will be reused from then on."
      );
    }

    this.logger.progress("Logged in — continuing.\n");
    await this.waitForSheetsToLoad(page);
  }

  private async waitForSheetsToLoad(page: Page): Promise<void> {
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
    const header = ["S.No.", ...COLUMNS.map((c) => c.header)];
    const dataRows = jobs.map((job, index) => [
      String(index + 1),
      ...COLUMNS.map((c) => this.sanitizeCell(c.value(job))),
    ]);
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
