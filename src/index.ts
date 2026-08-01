import { parseCliArgs, printUsage, type CliArgs } from "./cli/args";
import { runInteractivePrompts } from "./cli/interactive";
import { loadConfig } from "./config/load-config";
import { BrowserManager } from "./core/browser-manager";
import { Logger } from "./core/logger";
import type { SearchCriteria } from "./core/types";
import { JobSearchRunner } from "./orchestrator/job-search-runner";
import { ConsoleWriter } from "./output/console-writer";
import { GoogleSheetsWriter } from "./output/google-sheets-writer";
import type { OutputWriter } from "./output/output-writer";
import { AppleCareersScraper } from "./scrapers/apple/apple-careers-scraper";
import { ScraperRegistry } from "./scrapers/registry";

const logger = new Logger("main");

async function main(): Promise<void> {
  const partial = parseCliArgs(process.argv.slice(2));

  if (partial.help) {
    printUsage();
    return;
  }

  const config = loadConfig();

  // --- Register scrapers -------------------------------------------------
  // Adding a new company: implement CareerSiteScraper (see
  // scrapers/base/career-site-scraper.ts) and register() it here.
  const registry = new ScraperRegistry();
  registry.register(new AppleCareersScraper({ locale: config.appleLocale }));

  // --- Resolve run options: flags, interactive prompts, or a mix ---------
  const needsPrompts = partial.interactive || !partial.role;

  if (needsPrompts && !process.stdin.isTTY) {
    logger.error(
      "Missing --role and no interactive terminal is attached, so there's nothing to prompt for."
    );
    printUsage();
    process.exitCode = 1;
    return;
  }

  const args: CliArgs = needsPrompts
    ? await runInteractivePrompts(partial, {
        availableSites: registry.listNames(),
        sheetsConfigured: config.googleSheets.enabled,
      })
    : {
        role: partial.role!,
        location: partial.location,
        site: partial.site ?? "apple",
        maxResults: partial.maxResults,
        outputs: partial.outputs ?? ["console"],
      };

  // --- Browser -------------------------------------------------------------
  const browserManager = new BrowserManager({
    userDataDir: config.userDataDir,
    headless: config.headless,
    defaultTimeoutMs: config.defaultTimeoutMs,
  });
  const context = await browserManager.launch();

  try {
    // --- Output writers ----------------------------------------------------
    const writers: OutputWriter[] = [];
    for (const output of args.outputs) {
      if (output === "console") {
        writers.push(new ConsoleWriter());
      } else if (output === "sheets") {
        if (!config.googleSheets.enabled) {
          logger.error("Requested --output sheets but googleSheets.sheetUrl is empty in src/config/app.config.ts.");
          process.exitCode = 1;
          return;
        }
        writers.push(new GoogleSheetsWriter(context, config.googleSheets));
      } else {
        logger.warn(`Unknown output writer "${output}" — ignoring.`);
      }
    }

    if (writers.length === 0) {
      writers.push(new ConsoleWriter());
    }

    // --- Run -----------------------------------------------------------------
    const criteria: SearchCriteria = {
      role: args.role,
      location: args.location,
      maxResults: args.maxResults,
    };

    const runner = new JobSearchRunner(registry, writers);
    const result = await runner.run(context, args.site, criteria);

    logger.info(
      `Done. ${result.jobs.length} job(s) extracted, ${result.errors.length} error(s).`
    );
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        logger.warn(`  - ${err.context ?? ""}: ${err.message}`);
      }
    }
  } finally {
    await browserManager.close();
  }
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exitCode = 1;
});
