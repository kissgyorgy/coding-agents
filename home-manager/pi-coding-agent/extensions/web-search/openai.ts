/**
 * OpenAI API backend — direct Responses API with OPENAI_API_KEY or provider key.
 */
import type { SearchBackend } from "./types";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function openai(model: string): SearchBackend {
  const provider = "openai";
  return {
    name: `${provider}/${model}`,

    async getApiKey(ctx) {
      const envKey = process.env.OPENAI_API_KEY?.trim();
      if (envKey) return envKey;

      const resolved = ctx.modelRegistry.find(provider, model);
      if (resolved) {
        const key = await ctx.modelRegistry.getApiKey(resolved);
        if (key) return key;
      }

      return (ctx.modelRegistry as any).getApiKeyForProvider?.(provider);
    },

    buildRequest(apiKey, query, instructions) {
      return {
        url: `${OPENAI_BASE_URL}/responses`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          stream: true,
          instructions,
          input: [{ role: "user", content: query }],
          tools: [{ type: "web_search" }],
          tool_choice: "auto",
        }),
      };
    },
  };
}
