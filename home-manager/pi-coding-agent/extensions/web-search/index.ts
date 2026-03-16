/**
 * Web Search extension — provides a `web_search` tool that queries an LLM
 * with web search capabilities.
 *
 * Use `/websearch:model` to configure the provider and model from the TUI.
 * Settings are persisted to ~/.pi/agent/web-search.json.
 *
 * Available backends:
 *   openai(model)              — OpenAI Responses API (needs OPENAI_API_KEY or /login)
 *   openrouter(model)          — OpenRouter Responses API (needs /login or OPENROUTER_API_KEY)
 *   openai-subscription(model) — ChatGPT subscription via Codex endpoint (needs /login with OpenAI)
 *   anthropic(model)           — Anthropic Messages API with web search tool (needs ANTHROPIC_API_KEY)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getAgentDir,
  DynamicBorder,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  getEditorKeybindings,
  Input,
  Spacer,
  Text,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { parseResponsesSSE } from "./types";
import type { SearchBackend } from "./types";
import { openai } from "./openai";
import { openrouter } from "./openrouter";
import { openaiSubscription } from "./openai-subscription";
import { anthropic } from "./anthropic";

// ---------------------------------------------------------------------------
// Persistent settings
// ---------------------------------------------------------------------------

type BackendType =
  | "openai"
  | "openrouter"
  | "openai-subscription"
  | "anthropic";

interface WebSearchSettings {
  backend: BackendType;
  model: string;
}

const SETTINGS_PATH = join(getAgentDir(), "web-search.json");

const DEFAULT_SETTINGS: WebSearchSettings = {
  backend: "openai",
  model: "gpt-5.4",
};

function loadSettings(): WebSearchSettings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      return {
        ...DEFAULT_SETTINGS,
        ...JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: WebSearchSettings): void {
  mkdirSync(getAgentDir(), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function createBackend(settings: WebSearchSettings): SearchBackend {
  switch (settings.backend) {
    case "openai":
      return openai(settings.model);
    case "openrouter":
      return openrouter(settings.model);
    case "openai-subscription":
      return openaiSubscription(settings.model);
    case "anthropic":
      return anthropic(settings.model);
  }
}

const BACKEND_LABELS: Record<BackendType, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  "openai-subscription": "OpenAI Subscription (Codex)",
  anthropic: "Anthropic",
};

/** Map model-registry provider names to web-search backend types. */
const PROVIDER_TO_BACKEND: Record<string, BackendType> = {
  openai: "openai",
  openrouter: "openrouter",
  "openai-codex": "openai-subscription",
  anthropic: "anthropic",
};

// ---------------------------------------------------------------------------
// Active backend (mutable, updated via /websearch:model)
// ---------------------------------------------------------------------------

let settings = loadSettings();
let backend = createBackend(settings);

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
  // Show current backend in footer on session start
  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(
      "web-search",
      ctx.ui.theme.fg("dim", "🔍 ") +
        ctx.ui.theme.fg(
          "muted",
          `${BACKEND_LABELS[settings.backend]}/${settings.model}`,
        ),
    );
  }

  // /websearch:model — pick provider and model via TUI (same as /model)
  pi.registerCommand("websearch:model", {
    description: "Configure web search provider and model",
    handler: async (_args, ctx) => {
      const available = await ctx.modelRegistry.getAvailable();

      // Filter to providers that have a web-search backend
      const supported = available.filter(
        (m) => PROVIDER_TO_BACKEND[m.provider] !== undefined,
      );

      if (supported.length === 0) {
        ctx.ui.notify(
          "No models from supported providers (openai, openrouter, openai-codex, anthropic)",
          "warning",
        );
        return;
      }

      const currentKey = `${settings.backend === "openai-subscription" ? "openai-codex" : settings.backend}/${settings.model}`;

      interface ModelItem {
        provider: string;
        id: string;
        isCurrent: boolean;
      }

      // Sort: current model first, then by provider
      const allModels: ModelItem[] = supported
        .map((m) => ({
          provider: m.provider,
          id: m.id,
          isCurrent: `${m.provider}/${m.id}` === currentKey,
        }))
        .sort((a, b) => {
          if (a.isCurrent && !b.isCurrent) return -1;
          if (!a.isCurrent && b.isCurrent) return 1;
          return a.provider.localeCompare(b.provider);
        });

      const choice = await ctx.ui.custom<ModelItem | null>(
        (tui, theme, _kb, done) => {
          let filteredModels = allModels;
          let selectedIndex = 0;

          const container = new Container();

          // Top border
          container.addChild(
            new DynamicBorder((s: string) => theme.fg("accent", s)),
          );
          container.addChild(new Spacer(1));

          // Hint
          const hintText = new Text(
            theme.fg("muted", "Only showing models with web search support"),
            0,
            0,
          );
          container.addChild(hintText);
          container.addChild(new Spacer(1));

          // Search input
          const searchInput = new Input();
          container.addChild(searchInput);
          container.addChild(new Spacer(1));

          // List container
          const listContainer = new Container();
          container.addChild(listContainer);
          container.addChild(new Spacer(1));

          // Bottom border
          container.addChild(
            new DynamicBorder((s: string) => theme.fg("accent", s)),
          );

          function filterModels(query: string): void {
            filteredModels = query
              ? fuzzyFilter(
                  allModels,
                  query,
                  ({ id, provider }) => `${id} ${provider} ${provider}/${id}`,
                )
              : allModels;
            selectedIndex = Math.min(
              selectedIndex,
              Math.max(0, filteredModels.length - 1),
            );
            updateList();
          }

          function updateList(): void {
            listContainer.clear();

            const maxVisible = 10;
            const startIndex = Math.max(
              0,
              Math.min(
                selectedIndex - Math.floor(maxVisible / 2),
                filteredModels.length - maxVisible,
              ),
            );
            const endIndex = Math.min(
              startIndex + maxVisible,
              filteredModels.length,
            );

            for (let i = startIndex; i < endIndex; i++) {
              const item = filteredModels[i];
              if (!item) continue;

              const isSelected = i === selectedIndex;
              let line: string;

              if (isSelected) {
                const prefix = theme.fg("accent", "→ ");
                const modelText = theme.fg("accent", item.id);
                const providerBadge = theme.fg("muted", `[${item.provider}]`);
                const checkmark = item.isCurrent
                  ? theme.fg("success", " ✓")
                  : "";
                line = `${prefix}${modelText} ${providerBadge}${checkmark}`;
              } else {
                const providerBadge = theme.fg("muted", `[${item.provider}]`);
                const checkmark = item.isCurrent
                  ? theme.fg("success", " ✓")
                  : "";
                line = `  ${item.id} ${providerBadge}${checkmark}`;
              }

              listContainer.addChild(new Text(line, 0, 0));
            }

            // Scroll indicator
            if (startIndex > 0 || endIndex < filteredModels.length) {
              listContainer.addChild(
                new Text(
                  theme.fg(
                    "muted",
                    `  (${selectedIndex + 1}/${filteredModels.length})`,
                  ),
                  0,
                  0,
                ),
              );
            }

            if (filteredModels.length === 0) {
              listContainer.addChild(
                new Text(theme.fg("muted", "  No matching models"), 0, 0),
              );
            } else {
              const selected = filteredModels[selectedIndex];
              if (selected) {
                listContainer.addChild(new Spacer(1));
                listContainer.addChild(
                  new Text(
                    theme.fg(
                      "muted",
                      `  Provider: ${BACKEND_LABELS[PROVIDER_TO_BACKEND[selected.provider]]}`,
                    ),
                    0,
                    0,
                  ),
                );
              }
            }
          }

          updateList();

          const component: {
            render: (w: number) => string[];
            invalidate: () => void;
            handleInput: (data: string) => void;
            focused: boolean;
          } = {
            get focused() {
              return searchInput.focused;
            },
            set focused(value: boolean) {
              searchInput.focused = value;
            },
            render: (w: number) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data: string) => {
              const kb = getEditorKeybindings();

              if (kb.matches(data, "selectUp")) {
                if (filteredModels.length === 0) return;
                selectedIndex =
                  selectedIndex === 0
                    ? filteredModels.length - 1
                    : selectedIndex - 1;
                updateList();
                tui.requestRender();
              } else if (kb.matches(data, "selectDown")) {
                if (filteredModels.length === 0) return;
                selectedIndex =
                  selectedIndex === filteredModels.length - 1
                    ? 0
                    : selectedIndex + 1;
                updateList();
                tui.requestRender();
              } else if (kb.matches(data, "selectConfirm")) {
                const selected = filteredModels[selectedIndex];
                if (selected) done(selected);
              } else if (kb.matches(data, "selectCancel")) {
                done(null);
              } else {
                searchInput.handleInput(data);
                filterModels(searchInput.getValue());
                tui.requestRender();
              }
            },
          };

          return component;
        },
      );

      if (!choice) return;

      const backendType = PROVIDER_TO_BACKEND[choice.provider];
      if (!backendType) {
        ctx.ui.notify(`Unsupported provider: ${choice.provider}`, "error");
        return;
      }

      // Apply
      settings = { backend: backendType, model: choice.id };
      backend = createBackend(settings);
      saveSettings(settings);
      updateStatus(ctx);
      ctx.ui.notify(
        `Web search: ${BACKEND_LABELS[settings.backend]}/${settings.model}`,
        "info",
      );
    },
  });

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
