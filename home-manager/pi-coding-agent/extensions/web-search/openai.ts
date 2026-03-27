/**
 * OpenAI API backend — direct Responses API with OPENAI_API_KEY or provider key.
 */
import type { AuthResult, SearchBackend } from "./types";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function openai(model: string): SearchBackend {
  const provider = "openai";
  return {
    name: `${provider}/${model}`,

    async getAuth(ctx): Promise<AuthResult | undefined> {
      const envKey = process.env.OPENAI_API_KEY?.trim();
      if (envKey) return { apiKey: envKey };

      const resolved = ctx.modelRegistry.find(provider, model);
      if (resolved) {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolved);
        if (auth.ok) return { apiKey: auth.apiKey, headers: auth.headers };
      }

      const key = await (ctx.modelRegistry as any).getApiKeyForProvider?.(
        provider,
      );
      if (key) return { apiKey: key };
      return undefined;
    },

    buildRequest(auth, query, instructions) {
      return {
        url: `${OPENAI_BASE_URL}/responses`,
        headers: {
          ...auth.headers,
          Authorization: `Bearer ${auth.apiKey}`,
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
