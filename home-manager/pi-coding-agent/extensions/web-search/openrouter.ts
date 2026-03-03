/**
 * OpenRouter backend — standard Responses API via model registry baseUrl.
 */
import type { SearchBackend } from "./types";

export function openrouter(model: string): SearchBackend {
  const provider = "openrouter";
  return {
    name: `${provider}/${model}`,

    async getApiKey(ctx) {
      return (ctx.modelRegistry as any).getApiKeyForProvider?.(provider);
    },

    buildRequest(apiKey, query, instructions, ctx) {
      const resolved = ctx.modelRegistry.find(provider, model);
      if (!resolved?.baseUrl) {
        return {
          error: `Could not resolve base URL for '${provider}/${model}'. Is it configured?`,
        };
      }

      return {
        url: `${resolved.baseUrl}/responses`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
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
