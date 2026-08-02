/**
 * The one thing every AI backend adapter has to do: take a prompt, return
 * text. Everything provider-specific (auth headers, request/response
 * shape, endpoint URL) lives inside each adapter in `providers/` — nothing
 * outside this file ever needs to know which provider is in use.
 *
 * To switch providers, change `ai.provider` in `app.config.ts` — nothing
 * in `relevance-matcher.ts` or `job-search-runner.ts` needs to change.
 * To add a new provider (Claude, a local model, etc.), implement this
 * interface once and register it in `src/index.ts`.
 */
export interface AiProvider {
  /** Short identifier used in logs, e.g. "openai", "gemini". */
  readonly name: string;

  /** Sends a single prompt, returns the raw text response. */
  complete(prompt: string): Promise<string>;
}
