/**
 * Minimal leveled logger. Deliberately dependency-free: this is a local
 * automation tool, not a service, so pulling in winston/pino would be
 * overkill. Swap this out later if the project grows into something that
 * needs structured/shipped logs.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private readonly scope: string;
  private readonly minLevel: LogLevel;

  constructor(scope: string, minLevel: LogLevel = "info") {
    this.scope = scope;
    this.minLevel = minLevel;
  }

  child(subScope: string): Logger {
    return new Logger(`${this.scope}:${subScope}`, this.minLevel);
  }

  debug(message: string, meta?: unknown): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log("error", message, meta);
  }

  /**
   * Prints a plain section banner — no timestamp/level/scope prefix.
   * Use this to mark the start of a distinct phase (searching,
   * extracting, filtering, writing...) so someone watching the terminal
   * can tell at a glance which step is running, instead of parsing
   * tagged log lines.
   */
  banner(title: string): void {
    const line = "─".repeat(Math.max(24, title.length + 4));
    console.log(`\n${line}\n  ${title}\n${line}`);
  }

  /**
   * Prints a plain progress line — no timestamp/level/scope prefix.
   * Use this for per-item feedback within a step (e.g. "[3/25]
   * Extracting: <title>") so long-running loops aren't silent.
   */
  progress(message: string): void {
    console.log(message);
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.scope}]`;
    const consoleMethod =
      level === "error" ? console.error : level === "warn" ? console.warn : console.log;

    if (meta !== undefined) {
      consoleMethod(`${prefix} ${message}`, meta);
    } else {
      consoleMethod(`${prefix} ${message}`);
    }
  }
}
