/**
 * OpenRouter backend — standard Responses API via model registry baseUrl.
 */
import { requestHeaders } from "./types";
import type { AuthResult, SearchBackend } from "./types";

export function openrouter(model: string): SearchBackend {
  const provider = "openrouter";
  return {
    name: `${provider}/${model}`,

    async getAuth(ctx): Promise<AuthResult | undefined> {
      const providerAuth = await ctx.modelRegistry.getProviderAuth(provider);
      if (!providerAuth?.auth.apiKey) return undefined;
      return {
        apiKey: providerAuth.auth.apiKey,
        headers: providerAuth.auth.headers,
      };
    },

    buildRequest(auth, query, instructions, ctx) {
      const resolved = ctx.modelRegistry.find(provider, model);
      if (!resolved?.baseUrl) {
        return {
          error: `Could not resolve base URL for '${provider}/${model}'. Is it configured?`,
        };
      }

      return {
        url: `${resolved.baseUrl}/responses`,
        headers: {
          ...requestHeaders(auth.headers),
          Authorization: `Bearer ${auth.apiKey}`,
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
