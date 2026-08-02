import { GoogleGenAI } from "@google/genai";
import type { AiProvider } from "../ai-provider";

export interface GeminiProviderOptions {
  apiKey: string;
  /**
   * Defaults to gemini-2.5-flash-lite — Google's current model explicitly
   * recommended for "high-volume classification, simple data extraction."
   * Override in app.config.ts if you'd rather use a larger model.
   */
  model?: string;
}

/**
 * Adapter for Google's Gemini API via the official `@google/genai` SDK
 * (the current unified SDK — the older `@google/generative-ai` package is
 * deprecated). Handles auth, retries, and response parsing itself, so
 * this adapter is mostly just mapping our generic `complete(prompt)`
 * shape onto the SDK's `generateContent` call.
 */
export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey) {
      throw new Error("GeminiProvider requires an API key (set it in src/config/secrets.local.ts).");
    }
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? "gemini-2.5-flash-lite";
  }

  async complete(prompt: string): Promise<string> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          temperature: 0,
          // The caller's prompt already asks for JSON; this makes the
          // SDK enforce it, so there's no markdown-fence-stripping to do
          // on the response.
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Gemini API response contained no completion text.");
      }
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const looksLikeAuthError = /api key|401|403|permission|unauthenticated/i.test(message);
      const hint = looksLikeAuthError
        ? ' Double-check the key in secrets.local.ts is a standard API key from ' +
          'aistudio.google.com/apikey — it should start with "AIzaSy". Other Google credential ' +
          "formats (e.g. from the Gemini app or CLI OAuth flow) aren't accepted here."
        : "";
      throw new Error(`Gemini API error: ${message}${hint}`);
    }
  }
}
