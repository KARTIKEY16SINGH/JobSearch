const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "in",
  "on",
  "and",
  "or",
  "to",
  "with",
  "at",
]);

/**
 * Returns true if any meaningful word from the searched role appears in
 * the given text.
 *
 * This exists as a safety net against a career site's own search being
 * loose/fuzzy — or a scraper occasionally submitting a search before the
 * site's UI has actually applied it — either of which can hand back a job
 * that's clearly unrelated to what was searched. Trusting a site's search
 * results blindly isn't safe; this is a cheap, general (not
 * Apple-specific) sanity check any scraper's output can be run through.
 *
 * Callers should pass title + team, NOT a full job description: job
 * descriptions routinely mention unrelated departments in passing
 * boilerplate (e.g. "works closely with sales, marketing, and
 * engineering"), which makes a description-wide check pass almost
 * everything and defeats the point of this filter.
 *
 * Short, common words ("of", "the", "in"...) are ignored so a role like
 * "Manager of Sales" doesn't pass every job that happens to say "the" or
 * "of". If the role has no words left after filtering those out, this
 * returns true — there's nothing meaningful left to check against, so it
 * fails open rather than filtering everything out.
 */
export function isRoleRelevant(role: string, haystackText: string): boolean {
  const words = role
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  if (words.length === 0) return true;

  const haystack = haystackText.toLowerCase();
  return words.some((word) => haystack.includes(word));
}
