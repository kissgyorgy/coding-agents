/**
 * Anthropic backend — Messages API with web_search tool.
 *
 * Uses the Anthropic Messages streaming format (not OpenAI Responses API),
 * so provides a custom parseSSE implementation.
 */
import type { AuthResult, SearchBackend, SearchResult } from "./types";

const ANTHROPIC_API_VERSION = "2023-06-01";

export function anthropic(model: string): SearchBackend {
  const provider = "anthropic";
  return {
    name: `${provider}/${model}`,

    async getAuth(ctx): Promise<AuthResult | undefined> {
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

    buildRequest(auth, query, instructions, ctx) {
      const resolved = ctx.modelRegistry.find(provider, model);
      const baseUrl = resolved?.baseUrl || "https://api.anthropic.com";

      return {
        url: `${baseUrl}/v1/messages`,
        headers: {
          ...auth.headers,
          "x-api-key": auth.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          stream: true,
          system: instructions,
          messages: [{ role: "user", content: query }],
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 5,
            },
          ],
        }),
      };
    },

    parseSSE: parseAnthropicSSE,
  };
}

// ---------------------------------------------------------------------------
// Anthropic Messages SSE stream parser
// ---------------------------------------------------------------------------

async function parseAnthropicSSE(
  response: Response,
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const textParts: string[] = [];
  const searchQueries: string[] = [];

  try {
    while (true) {
      if (signal?.aborted) throw new Error("Request was aborted");

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        // Extract event type and data
        let eventType = "";
        const dataLines: string[] = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const data = dataLines.join("");
        if (!data || data === "[DONE]") {
          idx = buffer.indexOf("\n\n");
          continue;
        }

        try {
          const event = JSON.parse(data);

          if (eventType === "content_block_delta") {
            const delta = event?.delta;
            if (delta?.type === "text_delta" && delta?.text) {
              textParts.push(delta.text);
            }
          }

          // Capture search queries from server_tool_use blocks
          if (eventType === "content_block_start") {
            const block = event?.content_block;
            if (block?.type === "server_tool_use" && block?.input?.query) {
              searchQueries.push(block.input.query);
            }
          }

          // Also capture queries from completed input deltas
          if (eventType === "content_block_stop") {
            // queries already captured from content_block_start
          }

          if (eventType === "error") {
            const msg =
              event?.error?.message || event?.message || JSON.stringify(event);
            throw new Error(`API error: ${msg}`);
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            idx = buffer.indexOf("\n\n");
            continue;
          }
          throw e;
        }

        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text: textParts.join(""), searchQueries };
}
