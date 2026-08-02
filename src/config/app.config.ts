/**
 * All non-secret settings for the app live here — no .env file needed.
 * Edit the values below directly and re-run. This file is checked into
 * your repo, so don't put real secrets in it. The only thing that
 * currently needs one — an AI provider API key, if you turn on
 * `ai.provider` below — lives in `secrets.local.ts` instead (gitignored;
 * copy `secrets.local.example.ts` to create it).
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

  ai: {
    /**
     * Which relevance-checking strategy to use:
     * - "none"   — the free, instant keyword matcher (default, no API key needed)
     * - "openai" — batches every candidate job into one ChatGPT call
     * - "gemini" — batches every candidate job into one Gemini call
     * Requires the matching key in secrets.local.ts when set to "openai"
     * or "gemini" — falls back to the keyword matcher automatically if
     * the key is missing or the API call fails for any reason.
     */
    provider: "gemini",

    openai: {
      /** Override if you'd rather use a different OpenAI model. */
      model: "gpt-5-nano",
    },

    gemini: {
      /** Override if you'd rather use a different Gemini model. */
      model: "gemini-2.5-flash-lite",
    },
  },
};
