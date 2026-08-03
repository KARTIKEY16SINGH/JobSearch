import type { AiProvider } from "../ai/ai-provider";
import { extractMinYearsExperience } from "../core/experience";
import { isRoleRelevant } from "../core/relevance";
import { Logger } from "../core/logger";
import type { JobListing, SearchCriteria } from "../core/types";

/**
 * Decides which extracted jobs actually match what was searched for.
 * Two implementations below: the free/instant keyword check (default),
 * and an AI-backed one that batches every candidate into a single
 * provider call. `JobSearchRunner` only depends on this interface, so
 * switching between them — or adding a third strategy later — never
 * touches orchestrator or scraper code.
 *
 * Takes the full `SearchCriteria`, not just the role: the AI matcher
 * uses `maxYearsExperience` and `additionalCriteria` too (see
 * `AiRelevanceMatcher`); the keyword matcher only reads `role` since it
 * can't reasonably interpret free text or numeric constraints.
 */
export interface RelevanceMatcher {
  readonly name: string;
  filterRelevant(criteria: SearchCriteria, jobs: JobListing[]): Promise<JobListing[]>;
}

/**
 * Default matcher: substring-matches meaningful words from the role
 * against each job's title + team. Free, instant, no network call — see
 * `core/relevance.ts` for the matching logic and its known limitations.
 * Only considers `criteria.role` — `maxYearsExperience` and
 * `additionalCriteria` are not honored here (see `JobSearchRunner`,
 * which still applies its own deterministic experience-regex filter
 * afterward regardless of which matcher is active).
 */
export class KeywordRelevanceMatcher implements RelevanceMatcher {
  readonly name = "keyword";

  async filterRelevant(criteria: SearchCriteria, jobs: JobListing[]): Promise<JobListing[]> {
    return jobs.filter((job) => isRoleRelevant(criteria.role, `${job.title} ${job.team ?? ""}`));
  }
}

export interface AiRelevanceMatcherOptions {
  provider: AiProvider;
  /** Used whenever the AI call fails or returns something unparseable — one bad response should never break a whole run. */
  fallback?: RelevanceMatcher;
  logger?: Logger;
}

/**
 * AI-backed matcher: sends every extracted candidate (title, team, and a
 * years-of-experience hint — not the full description, which keeps the
 * prompt small and avoids the same boilerplate-noise problem the keyword
 * matcher had to work around) to the configured `AiProvider` in a SINGLE
 * batched call, asking it to judge relevance using real understanding
 * rather than substring matching.
 *
 * Unlike the keyword matcher, this one actually applies
 * `criteria.maxYearsExperience` and `criteria.additionalCriteria` as part
 * of its judgment — the AI is told the cap and the free-text criteria
 * and asked to only return jobs satisfying all of it. The years-of-
 * experience hint per job comes from the same regex-based
 * `extractMinYearsExperience` used elsewhere, but here it's a signal the
 * AI can weigh alongside title/team (e.g. "Senior" in the title implying
 * more years even when no explicit number is stated), rather than a
 * blind pass/fail on its own.
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

  async filterRelevant(criteria: SearchCriteria, jobs: JobListing[]): Promise<JobListing[]> {
    if (jobs.length === 0) return [];

    const prompt = this.buildPrompt(criteria, jobs);
    this.logger.progress(`  ↳ Sending ${jobs.length} candidate(s) to ${this.provider.name}:`);
    this.logger.progress(this.indent(prompt));

    let responseText: string;
    try {
      responseText = await this.provider.complete(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.progress(`  ↳ ${this.provider.name} call FAILED: ${message}`);
      this.logger.warn(
        `AI relevance check (${this.provider.name}) failed, falling back to keyword matching: ${message}`
      );
      return this.fallback.filterRelevant(criteria, jobs);
    }

    this.logger.progress(`  ↳ Raw response from ${this.provider.name}:`);
    this.logger.progress(this.indent(responseText));

    try {
      const relevantIds = this.parseResponse(responseText);
      this.logger.progress(`  ↳ Parsed relevant IDs: [${relevantIds.join(", ")}]`);

      const relevantSet = new Set(relevantIds);
      const filtered = jobs.filter((job) => relevantSet.has(job.id));

      // Parsing "succeeding" but matching literally nothing is much more
      // likely a format mismatch than every candidate being irrelevant —
      // fall back rather than silently return zero results.
      if (filtered.length === 0) {
        this.logger.progress(
          `  ↳ Matched 0 of ${jobs.length} candidates — treating as a format issue, not a real result.`
        );
        this.logger.warn(
          `AI relevance check (${this.provider.name}) matched 0 of ${jobs.length} candidates — that's ` +
            "more likely a response-format issue than a real result. Falling back to keyword matching."
        );
        return this.fallback.filterRelevant(criteria, jobs);
      }

      this.logger.progress(`  ↳ Kept ${filtered.length}/${jobs.length}: ${filtered.map((j) => j.title).join("; ")}`);
      return filtered;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.progress(`  ↳ Couldn't parse that response as JSON: ${message}`);
      this.logger.warn(
        `AI relevance check (${this.provider.name}) failed, falling back to keyword matching: ${message}`
      );
      return this.fallback.filterRelevant(criteria, jobs);
    }
  }

  private buildPrompt(criteria: SearchCriteria, jobs: JobListing[]): string {
    const candidateList = jobs
      .map((job) => {
        const minYears = extractMinYearsExperience(job.description);
        const experienceHint = minYears !== undefined ? `${minYears}+ years stated` : "not stated";
        return `- id: ${job.id} | title: ${job.title} | team: ${job.team ?? "unknown"} | experience: ${experienceHint}`;
      })
      .join("\n");

    const constraints: string[] = [];
    if (criteria.maxYearsExperience !== undefined) {
      constraints.push(
        `- Only include jobs that need at most ${criteria.maxYearsExperience} years of experience. Use the ` +
          `"experience" field as a hint, but also use your own judgment about seniority implied by the title ` +
          `and team when experience is "not stated" (e.g. a title containing "Senior", "Staff", "Lead", "Director", ` +
          `or "VP" usually implies more years than the cap even without an explicit number).`
      );
    }
    if (criteria.additionalCriteria) {
      constraints.push(`- Additional criteria from the searcher: ${criteria.additionalCriteria}`);
    }

    return [
      `You are filtering a list of job postings for relevance to a search.`,
      `Search role: "${criteria.role}"`,
      constraints.length > 0 ? `\nOther constraints to apply:\n${constraints.join("\n")}` : "",
      ``,
      `Candidate jobs:`,
      candidateList,
      ``,
      `Return ONLY a JSON object of this exact shape, with no other text, no markdown code fences, and no explanation:`,
      `{"relevantIds": ["id1", "id2"]}`,
      ``,
      `Include a job's id in "relevantIds" only if the job is a genuine, reasonable match for the search role ` +
        `AND satisfies every constraint listed above — use your judgment about what the title and team actually ` +
        `mean, not just literal keyword overlap.`,
    ]
      .filter((line) => line !== "")
      .join("\n");
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

  /** Indents a multi-line block for readability under a progress line, and caps it so a huge response doesn't flood the terminal. */
  private indent(text: string): string {
    const maxChars = 4000;
    const truncated = text.length > maxChars ? `${text.slice(0, maxChars)}\n... (truncated)` : text;
    return truncated
      .split("\n")
      .map((line) => `      ${line}`)
      .join("\n");
  }
}
