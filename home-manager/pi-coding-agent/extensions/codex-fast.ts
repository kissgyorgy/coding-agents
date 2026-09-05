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
const FAST_MODEL_LABEL = "GPT-5.5/5.6 Codex and GPT-6 Astra";
const FAST_MODEL_HINT =
  "openai-codex/gpt-5.5, openai-codex/gpt-5.6-*, or openai-codex/gpt-6-astra";

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

function isFastCodexModelId(modelId: unknown): modelId is string {
  return (
    modelId === "gpt-5.5" ||
    modelId === "gpt-5.6" ||
    modelId === "gpt-6-astra" ||
    (typeof modelId === "string" && modelId.startsWith("gpt-5.6-"))
  );
}

function isFastCodexModel(ctx: Pick<ExtensionContext, "model">): boolean {
  return (
    ctx.model?.provider === "openai-codex" && isFastCodexModelId(ctx.model.id)
  );
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
    fastEligible = isFastCodexModel(ctx);

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
    description: `Toggle ${FAST_MODEL_LABEL} Fast mode (priority service tier)`,
    handler: async (_args, ctx) => {
      updateStatus(ctx);

      if (!fastEligible) {
        ctx.ui.notify(
          `/fast is only available for ${FAST_MODEL_HINT}`,
          "warning",
        );
        return;
      }

      fastEnabled = !fastEnabled;
      persistState();
      updateStatus(ctx);
      ctx.ui.notify(
        `${FAST_MODEL_LABEL} Fast mode ${fastEnabled ? "enabled" : "disabled"}`,
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
    if (!fastEnabled || !isFastCodexModel(ctx)) return;
    if (!isObject(event.payload)) return;
    if (!isFastCodexModelId(event.payload.model)) return;

    return {
      ...event.payload,
      service_tier: "priority",
    };
  });
}
