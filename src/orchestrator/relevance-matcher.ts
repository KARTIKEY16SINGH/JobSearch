import type { AiProvider } from "../ai/ai-provider";
import { isRoleRelevant } from "../core/relevance";
import { Logger } from "../core/logger";
import type { JobListing } from "../core/types";

/**
 * Decides which extracted jobs actually match what was searched for.
 * Two implementations below: the free/instant keyword check (default),
 * and an AI-backed one that batches every candidate into a single
 * provider call. `JobSearchRunner` only depends on this interface, so
 * switching between them — or adding a third strategy later — never
 * touches orchestrator or scraper code.
 */
export interface RelevanceMatcher {
  readonly name: string;
  filterRelevant(role: string, jobs: JobListing[]): Promise<JobListing[]>;
}

/**
 * Default matcher: substring-matches meaningful words from the role
 * against each job's title + team. Free, instant, no network call — see
 * `core/relevance.ts` for the matching logic and its known limitations.
 */
export class KeywordRelevanceMatcher implements RelevanceMatcher {
  readonly name = "keyword";

  async filterRelevant(role: string, jobs: JobListing[]): Promise<JobListing[]> {
    return jobs.filter((job) => isRoleRelevant(role, `${job.title} ${job.team ?? ""}`));
  }
}

export interface AiRelevanceMatcherOptions {
  provider: AiProvider;
  /** Used whenever the AI call fails or returns something unparseable — one bad response should never break a whole run. */
  fallback?: RelevanceMatcher;
  logger?: Logger;
}

/**
 * AI-backed matcher: sends every extracted candidate (title + team, not
 * the full description — keeps the prompt small and avoids the same
 * boilerplate-noise problem the keyword matcher had to work around) to
 * the configured `AiProvider` in a SINGLE batched call, and asks it to
 * judge relevance using real understanding rather than substring
 * matching — e.g. it can recognize "Business Development Representative"
 * as sales-relevant even without the literal word "sales" appearing
 * anywhere.
 *
 * Always falls back to the keyword matcher on any failure: a network
 * error, a missing/invalid API key, or a response that doesn't parse as
 * the expected JSON shape. An AI outage should never turn into zero
 * results.
 */
export class AiRelevanceMatcher implements RelevanceMatcher {
  readonly name: string;
  private readonly provider: AiProvider;
  private readonly fallback: RelevanceMatcher;
  private readonly logger: Logger;

  constructor(options: AiRelevanceMatcherOptions) {
    this.provider = options.provider;
    this.fallback = options.fallback ?? new KeywordRelevanceMatcher();
    this.logger = options.logger ?? new Logger(`ai-relevance:${options.provider.name}`);
    this.name = `ai (${options.provider.name})`;
  }

  async filterRelevant(role: string, jobs: JobListing[]): Promise<JobListing[]> {
    if (jobs.length === 0) return [];

    try {
      const prompt = this.buildPrompt(role, jobs);
      const responseText = await this.provider.complete(prompt);
      const relevantIds = this.parseResponse(responseText);
      const relevantSet = new Set(relevantIds);
      const filtered = jobs.filter((job) => relevantSet.has(job.id));

      // Parsing "succeeding" but matching literally nothing is much more
      // likely a format mismatch than every candidate being irrelevant —
      // fall back rather than silently return zero results.
      if (filtered.length === 0) {
        this.logger.warn(
          `AI relevance check (${this.provider.name}) matched 0 of ${jobs.length} candidates — that's ` +
            "more likely a response-format issue than a real result. Falling back to keyword matching."
        );
        return this.fallback.filterRelevant(role, jobs);
      }

      this.logger.debug(`AI relevance check (${this.provider.name}): kept ${filtered.length}/${jobs.length}.`);
      return filtered;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `AI relevance check (${this.provider.name}) failed, falling back to keyword matching: ${message}`
      );
      return this.fallback.filterRelevant(role, jobs);
    }
  }

  private buildPrompt(role: string, jobs: JobListing[]): string {
    const candidateList = jobs
      .map((job) => `- id: ${job.id} | title: ${job.title} | team: ${job.team ?? "unknown"}`)
      .join("\n");

    return [
      `You are filtering a list of job postings for relevance to a search.`,
      `Search role: "${role}"`,
      ``,
      `Candidate jobs:`,
      candidateList,
      ``,
      `Return ONLY a JSON object of this exact shape, with no other text, no markdown code fences, and no explanation:`,
      `{"relevantIds": ["id1", "id2"]}`,
      ``,
      `Include a job's id in "relevantIds" only if the job is a genuine, reasonable match for someone ` +
        `searching for "${role}" — use your judgment about what the title and team actually mean, not just ` +
        `literal keyword overlap.`,
    ].join("\n");
  }

  private parseResponse(responseText: string): string[] {
    const cleaned = responseText.replace(/```json|```/g, "").trim();
    const parsed: unknown = JSON.parse(cleaned);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "relevantIds" in parsed &&
      Array.isArray((parsed as { relevantIds: unknown }).relevantIds)
    ) {
      return (parsed as { relevantIds: unknown[] }).relevantIds.map((id) => String(id));
    }

    throw new Error("AI response did not match the expected { relevantIds: string[] } shape.");
  }
}
