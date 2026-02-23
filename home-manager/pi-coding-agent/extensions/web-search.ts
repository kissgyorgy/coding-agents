/**
 * Web Search extension — uses the ChatGPT subscription (OpenAI Codex OAuth)
 * to perform web searches via the Codex Responses API.
 *
 * The ChatGPT backend supports a server-side `web_search` tool. This extension
 * sends a query to `chatgpt.com/backend-api/codex/responses` with that tool
 * enabled and streams back the search-augmented response.
 *
 * Requires: /login with OpenAI (ChatGPT Plus/Pro subscription).
 */
import { getModel } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as os from "node:os";

/** Wrap URLs in OSC 8 hyperlink sequences for clickable terminal links. */
function linkify(text: string): string {
  return text.replace(
    /(https?:\/\/[^\s)\]}>,"']+)/g,
    (url) => `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`,
  );
}

const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

/** Extract the chatgpt_account_id from the JWT access token. */
function extractAccountId(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT token");
  const payload = JSON.parse(atob(parts[1]!));
  const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
  if (!accountId)
    throw new Error("No chatgpt_account_id in token. Re-run /login.");
  return accountId;
}

/** Build headers matching the Codex client format. */
function buildHeaders(
  token: string,
  accountId: string,
): Record<string, string> {
  const userAgent = `pi (${os.platform()} ${os.release()}; ${os.arch()})`;
  return {
    Authorization: `Bearer ${token}`,
    "chatgpt-account-id": accountId,
    "OpenAI-Beta": "responses=experimental",
    originator: "pi",
    "User-Agent": userAgent,
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };
}

/** Parse SSE events and extract text content from the streamed response. */
async function parseSSEResponse(
  response: Response,
  signal?: AbortSignal,
): Promise<{ text: string; searchQueries: string[] }> {
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

            // Collect text deltas
            if (type === "response.output_text.delta") {
              textParts.push(event.delta ?? "");
            }

            // Collect web search queries for display
            if (type === "response.output_item.done") {
              const item = event?.item;
              if (item?.type === "web_search_call" && item?.action?.query) {
                searchQueries.push(item.action.query);
              }
            }

            // Handle errors
            if (type === "error") {
              const msg = event.message || event.code || JSON.stringify(event);
              throw new Error(`Codex error: ${msg}`);
            }
            if (type === "response.failed") {
              const msg = event.response?.error?.message;
              throw new Error(msg || "Codex response failed");
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue; // bad JSON, skip
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

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information. " +
      "Use when you need up-to-date facts, documentation or any information that may be online. " +
      "Returns a search-augmented answer with citations.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
    }),

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("web_search "));
      text += theme.fg("muted", args.query);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text("", 0, 0);
      }
      const text =
        result.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n") || "";
      if (!expanded) {
        const firstLine =
          text.split("\n").find((l: string) => l.trim()) || "Done";
        return new Text(linkify(theme.fg("toolOutput", firstLine)), 0, 0);
      }
      return new Text(linkify(theme.fg("toolOutput", text)), 0, 0);
    },

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Get the OpenAI Codex subscription token
      let apiKey: string | undefined;

      // Use a codex model to get the subscription token
      const codexModel = ctx.modelRegistry.find(
        "openai-codex",
        "gpt-5.1-codex-mini",
      );
      if (codexModel) {
        apiKey = await ctx.modelRegistry.getApiKey(codexModel);
      }

      // Fallback: try getApiKeyForProvider
      if (!apiKey) {
        apiKey = await (ctx.modelRegistry as any).getApiKeyForProvider?.(
          "openai-codex",
        );
      }

      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No OpenAI subscription token found. Run /login to authenticate with ChatGPT.",
            },
          ],
          isError: true,
        };
      }

      let accountId: string;
      try {
        accountId = extractAccountId(apiKey);
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Searching: ${params.query}...` }],
      });

      try {
        const body = {
          model: "gpt-5.1-codex-mini",
          store: false,
          stream: true,
          instructions:
            "You are a web search assistant. Search the web for the user's query and provide a concise, informative answer. Include relevant facts and dates. When citing sources, output each URL as a bare URL on its own line — never use markdown link syntax.",
          input: [
            {
              role: "user",
              content: params.query,
            },
          ],
          tools: [
            {
              type: "web_search",
              external_web_access: true,
            },
          ],
          tool_choice: "auto",
        };

        const url = `${CODEX_BASE_URL}/codex/responses`;
        const headers = buildHeaders(apiKey, accountId);

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          // Parse friendly error for rate limits
          try {
            const parsed = JSON.parse(errorText);
            const err = parsed?.error;
            if (err?.code?.includes("usage_limit") || response.status === 429) {
              const plan = err.plan_type
                ? ` (${err.plan_type.toLowerCase()} plan)`
                : "";
              const mins = err.resets_at
                ? Math.max(
                    0,
                    Math.round((err.resets_at * 1000 - Date.now()) / 60000),
                  )
                : undefined;
              const when =
                mins !== undefined ? ` Try again in ~${mins} min.` : "";
              return {
                content: [
                  {
                    type: "text",
                    text: `Usage limit reached${plan}.${when}`,
                  },
                ],
                isError: true,
              };
            }
          } catch {}
          return {
            content: [
              {
                type: "text",
                text: `Search API error (${response.status}): ${errorText}`,
              },
            ],
            isError: true,
          };
        }

        const { text, searchQueries } = await parseSSEResponse(
          response,
          signal,
        );

        // Convert markdown links [text](url) to bare URLs so terminals make them clickable
        let output = (text || "No results found.").replace(
          /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
          (_match, _linkText, url) => url,
        );

        if (searchQueries.length > 0) {
          output += "\n\n---\nSearch queries used: " + searchQueries.join(", ");
        }

        // Truncate if needed
        const truncation = truncateHead(output, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let finalOutput = truncation.content;
        if (truncation.truncated) {
          finalOutput +=
            `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
            `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
        }

        return {
          content: [{ type: "text", text: finalOutput }],
          details: { query: params.query, searchQueries },
        };
      } catch (err: any) {
        if (
          err.name === "AbortError" ||
          err.message === "Request was aborted"
        ) {
          return { content: [{ type: "text", text: "Search cancelled." }] };
        }
        return {
          content: [{ type: "text", text: `Search error: ${err.message}` }],
          isError: true,
        };
      }
    },
  });
}
