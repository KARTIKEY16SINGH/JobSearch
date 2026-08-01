import { chromium, type BrowserContext } from "playwright";
import { Logger } from "./logger";

export interface BrowserManagerOptions {
  /** Directory Chromium uses for cookies, local storage, login sessions, etc. */
  userDataDir: string;
  headless: boolean;
  /** Default navigation/action timeout applied to every page in the context. */
  defaultTimeoutMs: number;
}

/**
 * Owns the single persistent Playwright `BrowserContext` used for the whole
 * run. "Persistent" here means Chromium's user-data-dir is reused across
 * process runs, so once you log into Google (or Apple, if it ever needs
 * auth) in this profile, that session survives.
 *
 * Every scraper and output writer is handed the same `BrowserContext`
 * instance rather than creating its own, which is what "same browser
 * session" means in practice: one set of cookies, one set of tabs, opened
 * and closed as needed by whoever needs them.
 */
export class BrowserManager {
  private readonly options: BrowserManagerOptions;
  private readonly logger: Logger;
  private context: BrowserContext | null = null;

  constructor(options: BrowserManagerOptions, logger: Logger = new Logger("browser-manager")) {
    this.options = options;
    this.logger = logger;
  }

  async launch(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    this.logger.info(
      `Launching persistent context (headless=${this.options.headless}, profile=${this.options.userDataDir})`
    );

    this.context = await chromium.launchPersistentContext(this.options.userDataDir, {
      headless: this.options.headless,
      viewport: { width: 1400, height: 1000 },
      // Clipboard access is required by GoogleSheetsWriter, which pastes
      // data the same way a human would rather than typing cell-by-cell.
      permissions: ["clipboard-read", "clipboard-write"],
    });

    this.context.setDefaultTimeout(this.options.defaultTimeoutMs);
    this.context.setDefaultNavigationTimeout(this.options.defaultTimeoutMs);

    return this.context;
  }

  getContext(): BrowserContext {
    if (!this.context) {
      throw new Error("BrowserManager.launch() must be called before getContext().");
    }
    return this.context;
  }

  async close(): Promise<void> {
    if (this.context) {
      this.logger.info("Closing persistent browser context.");
      await this.context.close();
      this.context = null;
    }
  }
}
