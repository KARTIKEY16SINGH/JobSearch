export interface CliArgs {
  role: string;
  location?: string;
  site: string;
  maxResults?: number;
  maxYearsExperience?: number;
  additionalCriteria?: string;
  outputs: string[];
}

/** Raw flags as typed on the command line, before interactive prompts fill in any gaps. */
export interface PartialCliArgs {
  role?: string;
  location?: string;
  site?: string;
  maxResults?: number;
  maxYearsExperience?: number;
  additionalCriteria?: string;
  outputs?: string[];
  /** Forces interactive prompts even when enough flags were given to skip them. */
  interactive: boolean;
  help: boolean;
}

const USAGE = `
Usage:
  npm run dev                                   Run fully interactively
  npm run dev -- --role "Sales Manager"          Run with flags (non-interactive)

Options:
  --role <text>            Role/title to search for
  --location <text>        Optional location filter
  --site <name>             Career site to search (default: apple)
  --max <n>                 Maximum number of jobs to fully extract
  --max-experience <n>       Only keep jobs requiring at most n years of experience
  --criteria <text>          Extra free-text filter criteria — only honored with AI matching on
  --output <list>            Comma-separated writers to use: console,sheets (default: console)
  --interactive               Prompt for every option even if flags were also given
  --help                       Show this message

If --role is omitted, the app prompts for it (and everything else)
interactively instead of exiting with an error.
`;

/** Parses `--flag value` / `--flag=value` style args from argv. No external deps needed for this small a surface. */
export function parseCliArgs(argv: string[]): PartialCliArgs {
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;

    const eqIndex = token.indexOf("=");
    if (eqIndex !== -1) {
      flags.set(token.slice(2, eqIndex), token.slice(eqIndex + 1));
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, "true");
    }
  }

  const maxRaw = flags.get("max");
  const maxExperienceRaw = flags.get("max-experience");
  const outputRaw = flags.get("output");

  return {
    role: flags.get("role"),
    location: flags.get("location"),
    site: flags.get("site"),
    maxResults: maxRaw ? Number(maxRaw) : undefined,
    maxYearsExperience: maxExperienceRaw ? Number(maxExperienceRaw) : undefined,
    additionalCriteria: flags.get("criteria"),
    outputs: outputRaw
      ? outputRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    interactive: flags.has("interactive"),
    help: flags.has("help"),
  };
}

export function printUsage(): void {
  console.log(USAGE);
}
