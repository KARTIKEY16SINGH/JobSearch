import type { AiProvider } from "../ai-provider";

export interface OpenAiProviderOptions {
  apiKey: string;
  /**
   * Defaults to gpt-5-nano — OpenAI's cheapest/fastest current model,
   * explicitly positioned for classification-style tasks like this one.
   * Override in app.config.ts if you'd rather use a larger model.
   */
  model?: string;
}

/**
 * Adapter for OpenAI's Chat Completions API. Uses Node's built-in
 * `fetch` (Node 18+) — no SDK dependency needed for a single-endpoint
 * call like this.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: OpenAiProviderOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAiProvider requires an API key (set it in src/config/secrets.local.ts).");
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-5-nano";
  }

  async complete(prompt: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`OpenAI API error ${response.status}: ${bodyText.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("OpenAI API response contained no completion text.");
    }
    return text;
  }
}
