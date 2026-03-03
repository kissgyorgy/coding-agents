/**
 * Web Search extension — provides a `web_search` tool that queries an LLM
 * with web search capabilities.
 *
 * Configure the active backend below:
 *
 *   openrouter(model)          — OpenRouter Responses API (needs /login or OPENROUTER_API_KEY)
 *   openaiSubscription(model)  — ChatGPT subscription via Codex endpoint (needs /login with OpenAI)
 *   anthropic(model)           — Anthropic Messages API with web search tool (needs ANTHROPIC_API_KEY)
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { parseResponsesSSE } from "./types";
import { openai } from "./openai";
import { openrouter } from "./openrouter";
import { openaiSubscription } from "./openai-subscription";
import { anthropic } from "./anthropic";

// ---------------------------------------------------------------------------
// Backend selection — uncomment one:
// ---------------------------------------------------------------------------

// const backend = openai("gpt-5.3-codex");
const backend = openrouter("openai/gpt-5.3-chat");
// const backend = openaiSubscription("gpt-5.3-codex");
// const backend = anthropic("claude-haiku-4-5-20251001");

const SEARCH_INSTRUCTIONS =
  "You are a web search assistant. Search the web for the user's query and provide a concise, informative answer. Include relevant facts and dates. When citing sources, output each URL as a bare URL on its own line — never use markdown link syntax.";

/** Wrap URLs in OSC 8 hyperlink sequences for clickable terminal links. */
function linkify(text: string): string {
  return text.replace(
    /(https?:\/\/[^\s)\]}>,"']+)/g,
    (url) => `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`,
  );
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
      const apiKey = await backend.getApiKey(ctx);
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: `Error: No API key found for ${backend.name}.`,
            },
          ],
          isError: true,
        };
      }

      const req = backend.buildRequest(
        apiKey,
        params.query,
        SEARCH_INSTRUCTIONS,
        ctx,
      );
      if ("error" in req) {
        return {
          content: [{ type: "text", text: `Error: ${req.error}` }],
          isError: true,
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Searching: ${params.query}...` }],
      });

      try {
        const response = await fetch(req.url, {
          method: "POST",
          headers: req.headers,
          body: req.body,
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
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
                  { type: "text", text: `Usage limit reached${plan}.${when}` },
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

        // Use backend-specific parser if provided, otherwise default Responses API parser
        const parse = backend.parseSSE ?? parseResponsesSSE;
        const { text, searchQueries } = await parse(response, signal);

        // Convert markdown links to bare URLs for clickable terminal links
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
