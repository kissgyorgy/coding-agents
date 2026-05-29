import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteSuggestions } from "@earendil-works/pi-tui";

const STATE_ENTRY = "codex-fast";
const SETTINGS_PATH = join(getAgentDir(), "codex-fast.json");

interface FastState {
  enabled: boolean;
  updatedAt: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFastState(
  data: unknown,
  fallbackUpdatedAt = 0,
): FastState | undefined {
  if (!isObject(data) || typeof data.enabled !== "boolean") return undefined;

  const updatedAt =
    typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
      ? data.updatedAt
      : fallbackUpdatedAt;

  return { enabled: data.enabled, updatedAt };
}

function loadFastState(): FastState | undefined {
  try {
    if (!existsSync(SETTINGS_PATH)) return undefined;
    return normalizeFastState(JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")));
  } catch {
    return undefined;
  }
}

function saveFastState(state: FastState): void {
  try {
    mkdirSync(getAgentDir(), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(state, null, 2) + "\n");
  } catch (error) {
    console.error(`Failed to persist Codex Fast setting: ${error}`);
  }
}

function readEntryFastState(
  entry: { timestamp?: string; data?: unknown } | undefined,
): FastState | undefined {
  if (!entry) return undefined;

  const fallbackUpdatedAt = entry.timestamp ? Date.parse(entry.timestamp) : 0;
  return normalizeFastState(
    entry.data,
    Number.isFinite(fallbackUpdatedAt) ? fallbackUpdatedAt : 0,
  );
}

function isGpt55Codex(ctx: Pick<ExtensionContext, "model">): boolean {
  return ctx.model?.provider === "openai-codex" && ctx.model.id === "gpt-5.5";
}

function filterFastCommandSuggestions(
  suggestions: AutocompleteSuggestions | null,
  showFastCommand: boolean,
): AutocompleteSuggestions | null {
  if (!suggestions || showFastCommand) return suggestions;

  const items = suggestions.items.filter((item) => item.label !== "fast");

  return items.length > 0 ? { ...suggestions, items } : null;
}

export default function codexFastExtension(pi: ExtensionAPI): void {
  let fastEnabled = false;
  let fastEligible = false;

  function persistState(): void {
    const state: FastState = { enabled: fastEnabled, updatedAt: Date.now() };
    pi.appendEntry(STATE_ENTRY, state);
    saveFastState(state);
  }

  function updateStatus(ctx: ExtensionContext): void {
    fastEligible = isGpt55Codex(ctx);

    if (!fastEligible) {
      ctx.ui.setStatus("codex-fast", undefined);
      return;
    }

    ctx.ui.setStatus(
      "codex-fast",
      fastEnabled
        ? ctx.ui.theme.fg("accent", "⚡fast")
        : ctx.ui.theme.fg("dim", "🐢 fast off"),
    );
  }

  pi.registerCommand("fast", {
    description: "Toggle GPT-5.5 Codex Fast mode (priority service tier)",
    handler: async (_args, ctx) => {
      updateStatus(ctx);

      if (!fastEligible) {
        ctx.ui.notify(
          "/fast is only available for openai-codex/gpt-5.5",
          "warning",
        );
        return;
      }

      fastEnabled = !fastEnabled;
      persistState();
      updateStatus(ctx);
      ctx.ui.notify(
        `GPT-5.5 Codex Fast mode ${fastEnabled ? "enabled" : "disabled"}`,
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const entry = ctx.sessionManager
      .getEntries()
      .filter(
        (e: { type: string; customType?: string }) =>
          e.type === "custom" && e.customType === STATE_ENTRY,
      )
      .pop() as { timestamp?: string; data?: unknown } | undefined;

    const globalState = loadFastState();
    const sessionState = readEntryFastState(entry);
    const state = [globalState, sessionState]
      .filter((item): item is FastState => item !== undefined)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .pop();

    if (state) fastEnabled = state.enabled;

    updateStatus(ctx);

    ctx.ui.addAutocompleteProvider((current) => ({
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const suggestions = await current.getSuggestions(
          lines,
          cursorLine,
          cursorCol,
          options,
        );
        return filterFastCommandSuggestions(suggestions, fastEligible);
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        return current.applyCompletion(
          lines,
          cursorLine,
          cursorCol,
          item,
          prefix,
        );
      },
      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        return (
          current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
          true
        );
      },
    }));
  });

  pi.on("model_select", async (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!fastEnabled || !isGpt55Codex(ctx)) return;
    if (!isObject(event.payload)) return;
    if (event.payload.model !== "gpt-5.5") return;

    return {
      ...event.payload,
      service_tier: "priority",
    };
  });
}
