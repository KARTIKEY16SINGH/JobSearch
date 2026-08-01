/**
 * All settings for the app live here — no .env file needed. Edit the
 * values below directly and re-run. This file is checked into your repo,
 * so don't put real secrets in it (there aren't any needed for this
 * project: Google Sheets auth lives in the persistent browser profile in
 * `userDataDir`, not a key in this file).
 */
export const appConfig = {
  /**
   * Run the browser headed (false) so you can watch it work and complete
   * Google login the first time. Switch to true once your persistent
   * profile is already logged in and you just want it to run quietly.
   */
  headless: false,

  /**
   * Folder where the persistent browser profile (cookies, local storage,
   * Google login session, etc.) is stored between runs. Don't commit
   * this folder — it holds your real login session.
   */
  userDataDir: "./.browser-profile",

  /** Default timeout (ms) applied to Playwright navigations/waits. */
  defaultTimeoutMs: 30000,

  apple: {
    /**
     * Apple Careers locale path segment — controls which regional site
     * gets searched (jobs.apple.com/<locale>/search).
     * Examples: "en-us" (United States), "en-in" (India), "en-gb" (UK).
     */
    locale: "en-in",
  },

  googleSheets: {
    /**
     * Full URL of the target spreadsheet, e.g.
     * "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit"
     * Leave as "" to disable Google Sheets output entirely.
     */
    sheetUrl: "",

    /**
     * Name of the sheet/tab to write into. Leave as "" to use whichever
     * tab is active when the spreadsheet opens.
     */
    sheetTab: "",

    /** Top-left cell where the header row should be written. */
    startCell: "A1",
  },
};
