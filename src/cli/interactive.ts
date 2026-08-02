import * as readline from "node:readline/promises";
import type { PartialCliArgs, CliArgs } from "./args";

export interface InteractiveContext {
  /** Site names available in the scraper registry, for the site prompt. */
  availableSites: string[];
  /** Whether Google Sheets output is usable (GOOGLE_SHEET_URL configured). */
  sheetsConfigured: boolean;
}

/**
 * Prompts on stdin/stdout for whichever CliArgs fields weren't already
 * supplied as flags, then returns a fully-populated CliArgs. Flags always
 * win: if `--role "Sales Manager"` was passed, that question is skipped
 * entirely (unless `--interactive` forces every question to be asked).
 */
export async function runInteractivePrompts(
  partial: PartialCliArgs,
  ctx: InteractiveContext
): Promise<CliArgs> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\nJob Search Automation — interactive setup");
    console.log("(press Enter to accept the default shown in [brackets])\n");

    const role = await askRequired(rl, partial, "role", 'Role to search for (e.g. "Sales Manager")');

    const site = await askChoice(
      rl,
      partial,
      "site",
      `Career site to search`,
      ctx.availableSites,
      ctx.availableSites[0] ?? "apple"
    );

    const location = await askOptional(rl, partial, "location", "Location filter (blank = any)");

    const maxResults = await askNumber(
      rl,
      partial,
      "maxResults",
      "Max number of jobs to fully open and extract (blank = no limit)"
    );

    const maxYearsExperience = await askNumber(
      rl,
      partial,
      "maxYearsExperience",
      "Only keep jobs requiring at most this many years of experience (blank = any)"
    );

    const outputs = await askOutputs(rl, partial, ctx.sheetsConfigured);

    console.log("\nReady:");
    console.log(`  Role:       ${role}`);
    console.log(`  Site:       ${site}`);
    console.log(`  Location:   ${location ?? "(any)"}`);
    console.log(`  Max jobs:   ${maxResults ?? "(no limit)"}`);
    console.log(`  Experience: ${maxYearsExperience !== undefined ? `up to ${maxYearsExperience} years` : "(any)"}`);
    console.log(`  Output:     ${outputs.join(", ")}\n`);

    const proceed = await askYesNo(rl, "Start the search?", true);
    if (!proceed) {
      console.log("Cancelled.");
      process.exit(0);
    }

    return { role, site, location, maxResults, maxYearsExperience, outputs };
  } finally {
    rl.close();
  }
}

async function askRequired(
  rl: readline.Interface,
  partial: PartialCliArgs,
  key: "role",
  question: string
): Promise<string> {
  if (partial[key] && !partial.interactive) return partial[key]!;

  let answer = partial[key] ?? "";
  while (!answer.trim()) {
    answer = (await rl.question(`${question}: `)).trim();
    if (!answer.trim()) {
      console.log("This field is required.");
    }
  }
  return answer.trim();
}

async function askOptional(
  rl: readline.Interface,
  partial: PartialCliArgs,
  key: "location",
  question: string
): Promise<string | undefined> {
  if (partial[key] !== undefined && !partial.interactive) return partial[key];

  const answer = (await rl.question(`${question}: `)).trim();
  return answer.length > 0 ? answer : undefined;
}

async function askNumber(
  rl: readline.Interface,
  partial: PartialCliArgs,
  key: "maxResults" | "maxYearsExperience",
  question: string
): Promise<number | undefined> {
  if (partial[key] !== undefined && !partial.interactive) return partial[key];

  while (true) {
    const answer = (await rl.question(`${question}: `)).trim();
    if (answer.length === 0) return undefined;
    const parsed = Number(answer);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
    console.log("Please enter a whole number 0 or greater, or leave blank.");
  }
}

async function askChoice(
  rl: readline.Interface,
  partial: PartialCliArgs,
  key: "site",
  question: string,
  choices: string[],
  defaultValue: string
): Promise<string> {
  if (partial[key] && !partial.interactive) return partial[key]!;

  if (choices.length <= 1) return defaultValue;

  console.log(`${question}: ${choices.join(", ")}`);
  while (true) {
    const answer = (await rl.question(`Choice [${defaultValue}]: `)).trim();
    if (answer.length === 0) return defaultValue;
    if (choices.includes(answer)) return answer;
    console.log(`Please choose one of: ${choices.join(", ")}`);
  }
}

async function askOutputs(
  rl: readline.Interface,
  partial: PartialCliArgs,
  sheetsConfigured: boolean
): Promise<string[]> {
  if (partial.outputs && partial.outputs.length > 0 && !partial.interactive) {
    return partial.outputs;
  }

  const options = sheetsConfigured
    ? ["console", "sheets", "console,sheets"]
    : ["console"];

  if (!sheetsConfigured) {
    console.log(
      "(Google Sheets output not offered: set googleSheets.sheetUrl in src/config/app.config.ts to enable it.)"
    );
    return ["console"];
  }

  console.log("Where should results go?");
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));

  while (true) {
    const answer = (await rl.question(`Choice [1]: `)).trim();
    if (answer.length === 0) return options[0]!.split(",");
    const index = Number(answer) - 1;
    if (index >= 0 && index < options.length) return options[index]!.split(",");
    console.log(`Please enter a number from 1 to ${options.length}.`);
  }
}

async function askYesNo(rl: readline.Interface, question: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await rl.question(`${question} ${suffix}: `)).trim().toLowerCase();
  if (answer.length === 0) return defaultYes;
  return answer.startsWith("y");
}
