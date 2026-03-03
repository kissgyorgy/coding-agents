/**
 * Shared types and SSE parsing for web-search backends.
 */

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

export interface SearchBackend {
  /** Human-readable name for error messages. */
  name: string;
  /** Obtain an API key from the model registry. */
  getApiKey(ctx: any): Promise<string | undefined>;
  buildRequest(
    apiKey: string,
    query: string,
    instructions: string,
    ctx: any,
  ):
    | { url: string; headers: Record<string, string>; body: string }
    | { error: string };
  /** Parse the SSE stream. Defaults to parseResponsesSSE if not provided. */
  parseSSE?: (
    response: Response,
    signal?: AbortSignal,
  ) => Promise<SearchResult>;
}

export interface SearchResult {
  text: string;
  searchQueries: string[];
}

// ---------------------------------------------------------------------------
// Shared: parse OpenAI Responses API SSE stream
// ---------------------------------------------------------------------------

export async function parseResponsesSSE(
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

        const dataLines = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());

        for (const data of dataLines) {
          if (!data || data === "[DONE]") continue;
          try {
            const event = JSON.parse(data);
            const type = event?.type;

            if (type === "response.output_text.delta") {
              textParts.push(event.delta ?? "");
            }

            if (type === "response.output_item.done") {
              const item = event?.item;
              if (item?.type === "web_search_call" && item?.action?.query) {
                searchQueries.push(item.action.query);
              }
            }

            if (type === "error") {
              const msg = event.message || event.code || JSON.stringify(event);
              throw new Error(`API error: ${msg}`);
            }
            if (type === "response.failed") {
              const msg = event.response?.error?.message;
              throw new Error(msg || "Response failed");
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }

        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text: textParts.join(""), searchQueries };
}
