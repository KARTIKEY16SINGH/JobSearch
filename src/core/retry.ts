import { Logger } from "./logger";

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  /** Multiplies delayMs after every failed attempt. 1 = constant delay. */
  backoffFactor?: number;
  logger?: Logger;
  /** Short label used in log messages, e.g. "apple.search". */
  label?: string;
}

/**
 * Runs `fn`, retrying on thrown errors with optional exponential backoff.
 * Scraping real websites means flaky selectors, slow loads, and transient
 * network hiccups are the norm rather than the exception, so this is used
 * throughout the scraper layer instead of ad-hoc try/catch loops.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, delayMs = 1000, backoffFactor = 2, logger, label = "operation" } = options;

  let lastError: unknown;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn(`${label} failed on attempt ${attempt}/${attempts}: ${message}`);

      if (attempt < attempts) {
        await sleep(currentDelay);
        currentDelay *= backoffFactor;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after ${attempts} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
