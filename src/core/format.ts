/** Turns a scraper's siteName into a human-readable company name, e.g. "apple" -> "Apple". */
export function toCompanyName(sourceSite: string): string {
  if (!sourceSite) return sourceSite;
  return sourceSite.charAt(0).toUpperCase() + sourceSite.slice(1);
}
