/**
 * Copy this file to `secrets.local.ts` (already gitignored — see
 * .gitignore) and fill in whichever API key you actually plan to use.
 * Only needed if you set `ai.provider` to "openai" or "gemini" in
 * `app.config.ts"; leave it as "none" and this file is never read.
 *
 * Never commit real keys — that's the entire reason this is a separate
 * file from app.config.ts instead of living there too.
 */
export const secrets = {
  /** From https://platform.openai.com/api-keys — only needed if ai.provider is "openai". */
  openaiApiKey: "",

  /** From https://aistudio.google.com/apikey — only needed if ai.provider is "gemini". */
  geminiApiKey: "",
};
