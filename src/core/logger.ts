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
