/**
 * This is your actual secrets file — fill in whichever API key you
 * actually plan to use. Only needed if `ai.provider` in app.config.ts is
 * set to "openai" or "gemini"; leave it as "none" and this file is never
 * read.
 *
 * This file is gitignored — never commit real keys here.
 */
export const glocalAiConstants = {
	/** From https://platform.openai.com/api-keys — only needed if ai.provider is "openai". */
	openaiApiKey: "",

	/** From https://aistudio.google.com/apikey — only needed if ai.provider is "gemini". */
	geminiApiKey: "",
};
