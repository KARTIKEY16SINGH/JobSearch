/**
 * Best-effort extraction of a minimum years-of-experience requirement
 * from freeform job description/qualifications text.
 *
 * Job postings phrase this inconsistently — "6+ years of relevant
 * experience", "3-5 years experience", "minimum of 2 years professional
 * experience" — so this is a heuristic, not a guarantee. It looks for
 * numbers near the word "experience", and returns the SMALLEST one
 * found. That matters when a posting lists multiple qualifying paths
 * (e.g. "6+ years experience, or a Master's degree with 2 years") — the
 * smallest number is the easiest path to qualify under, which is what
 * "I want jobs requiring 7 years or less" should mean.
 *
 * This is site-agnostic on purpose (not Apple-specific): any scraper's
 * job description text can be run through it the same way.
 */
export function extractMinYearsExperience(text: string): number | undefined {
  if (!text) return undefined;

  const patterns = [
    // "6+ years of relevant experience", "3-5 years experience"
    /(\d+)\+?\s*(?:-\s*\d+\s*)?\s*years?\s+(?:of\s+)?(?:relevant\s+|related\s+|professional\s+|work\s+|industry\s+)?experience/gi,
    // "experience: 6+ years", "experience of at least 3 years"
    /experience[^.\n]{0,40}?(\d+)\+?\s*years?/gi,
  ];

  const numbers: number[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      // Sanity bound: reject obvious non-experience numbers a looser
      // regex might catch (years founded, product model numbers, etc.).
      if (Number.isFinite(value) && value >= 0 && value <= 40) {
        numbers.push(value);
      }
    }
  }

  if (numbers.length === 0) return undefined;
  return Math.min(...numbers);
}
