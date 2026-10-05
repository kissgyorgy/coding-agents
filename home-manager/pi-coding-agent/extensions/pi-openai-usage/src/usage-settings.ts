import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
  type LoadedUsageConfig,
  type UsageConfigPatch,
  loadUsageConfig,
  patchUsageConfig,
} from "./config";
import { resolveCodexOAuthCredentials, type CodexCredentialResolution } from "./auth";
import { createUsageCommandFacade } from "./usage-command-facade";
import {
  createUsageRefreshCoordinator,
  type UsageRefreshCoordinator,
} from "./usage-refresh-coordinator";
import {
  fetchCodexUsage,
  type UsageClientPort,
} from "./usage-client";
import { type UsageStateStore, createUsageStateStore } from "./usage-state";
import { formatDiagnosticsReport } from "./diagnostics-reporter";
import { openInteractiveSettingsMenu } from "./interactive-settings-menu";

type UsageSettingsCommandContext = Pick<
  ExtensionCommandContext,
  "ui" | "model" | "modelRegistry" | "signal" | "hasUI"
>;

type ConfigPatchWriter = (configPath: string, patch: UsageConfigPatch) => void;
type ConfigChangedCallback = (ctx: UsageSettingsCommandContext) => void | Promise<void>;
type StatusLineReapplyCallback = (ctx: UsageSettingsCommandContext) => void | Promise<void>;

type UsageSettingsCommandDependencies = {
  loadConfig?: () => LoadedUsageConfig;
  resolveCredentials?: (
    ctx: UsageSettingsCommandContext,
  ) => Promise<CodexCredentialResolution>;
  usageClient?: UsageClientPort;
  usageState?: UsageStateStore;
  usageRefreshCoordinator?: UsageRefreshCoordinator;
  patchConfig?: ConfigPatchWriter;
  onConfigChanged?: ConfigChangedCallback;
  reapplyStatusLine?: StatusLineReapplyCallback;
};

const defaultUsageClient: UsageClientPort = {
  fetchUsage: fetchCodexUsage,
};

export type { UsageSettingsCommandDependencies };

export function registerOpenAIUsageSettingsCommand(
  pi: ExtensionAPI,
  dependencies: UsageSettingsCommandDependencies = {},
): void {
  const loadConfig = dependencies.loadConfig ?? loadUsageConfig;
  const resolveCredentials = dependencies.resolveCredentials ?? defaultResolveCredentials;
  const usageClient = dependencies.usageClient ?? defaultUsageClient;
  const usageState = dependencies.usageState ?? createUsageStateStore();
  const usageRefreshCoordinator =
    dependencies.usageRefreshCoordinator ??
    createUsageRefreshCoordinator({ usageClient, usageState });
  const patchConfig = dependencies.patchConfig ?? patchUsageConfig;
  const onConfigChanged = dependencies.onConfigChanged ?? noopConfigChanged;
  const reapplyStatusLine = dependencies.reapplyStatusLine ?? noopStatusLineReapply;
  const usageCommandFacade = createUsageCommandFacade({
    loadConfig,
    resolveCredentials: (ctx) => resolveCredentials(ctx as UsageSettingsCommandContext),
    usageRefreshCoordinator,
  });

  pi.registerCommand("openai-usage-settings", {
    description: "OpenAI usage settings and utility subcommands",
    getArgumentCompletions(argumentPrefix: string) {
      return suggestSettingsSubcommands(argumentPrefix);
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();
      const commandContext = asUsageSettingsContext(ctx);

      const lowered = trimmed.toLowerCase();
      if (trimmed.length === 0) {
        await handleShowSettings({
          commandContext,
          loadConfig,
          patchConfig,
          onConfigChanged,
          reapplyStatusLine,
        });
        return;
      }

      if (isSubcommandInvocation(lowered, "show")) {
        notify(ctx, removedShowPathText());
        return;
      }

      if (isSubcommandInvocation(lowered, "debug")) {
        notify(ctx, removedDebugPathText());
        return;
      }

      if (lowered === "usage") {
        await usageCommandFacade.showUsage(commandContext);
        return;
      }

      if (lowered === "refresh") {
        await usageCommandFacade.showUsage(commandContext, { forceRefresh: true });
        return;
      }

      if (lowered === "help") {
        notify(ctx, usageSettingsHelpText());
        return;
      }

      if (lowered === "diagnostics") {
        await handleDiagnostics({ commandContext, loadConfig, resolveCredentials, usageState });
        return;
      }

      if (isRemovedSetInvocation(lowered)) {
        notify(ctx, removedSetPathText());
        return;
      }

      notify(ctx, "Unknown /openai-usage-settings subcommand. Use /openai-usage-settings help");
    },
  });
}

async function handleShowSettings(options: {
  commandContext: UsageSettingsCommandContext;
  loadConfig: () => LoadedUsageConfig;
  patchConfig: ConfigPatchWriter;
  onConfigChanged: ConfigChangedCallback;
  reapplyStatusLine: StatusLineReapplyCallback;
}): Promise<void> {
  const { commandContext, loadConfig, patchConfig, onConfigChanged, reapplyStatusLine } = options;
  if (!commandContext.hasUI || typeof commandContext.ui.custom !== "function") {
    notify(commandContext, usageSettingsNoUiFallbackText());
    return;
  }

  const loaded = loadConfig();
  await openInteractiveSettingsMenu(commandContext, loaded.effective, {
    onPatch: (patch) =>
      handleInteractiveSettingsPatch({
        commandContext,
        configPath: loaded.configPath,
        patch,
        patchConfig,
        onConfigChanged,
        reapplyStatusLine,
      }),
  });
}

function handleInteractiveSettingsPatch(options: {
  commandContext: UsageSettingsCommandContext;
  configPath: string;
  patch: UsageConfigPatch;
  patchConfig: ConfigPatchWriter;
  onConfigChanged: ConfigChangedCallback;
  reapplyStatusLine: StatusLineReapplyCallback;
}): void {
  const { commandContext, configPath, patch, patchConfig, onConfigChanged, reapplyStatusLine } =
    options;

  try {
    patchConfig(configPath, patch);
  } catch {
    return;
  }

  applySuccessfulMenuWriteSideEffects({
    commandContext,
    onConfigChanged,
    reapplyStatusLine,
  });
}

function applySuccessfulMenuWriteSideEffects(options: {
  commandContext: UsageSettingsCommandContext;
  onConfigChanged: ConfigChangedCallback;
  reapplyStatusLine: StatusLineReapplyCallback;
}): void {
  const { commandContext, onConfigChanged, reapplyStatusLine } = options;

  try {
    const configChanged = onConfigChanged(commandContext);
    if (isPromiseLike(configChanged)) {
      void Promise.resolve(configChanged)
        .then(() => reapplyStatusLine(commandContext))
        .catch(() => undefined);
      return;
    }

    const reapplied = reapplyStatusLine(commandContext);
    if (isPromiseLike(reapplied)) {
      void Promise.resolve(reapplied).catch(() => undefined);
    }
  } catch {
    return;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

async function handleDiagnostics(options: {
  commandContext: UsageSettingsCommandContext;
  loadConfig: () => LoadedUsageConfig;
  resolveCredentials: (ctx: UsageSettingsCommandContext) => Promise<CodexCredentialResolution>;
  usageState: UsageStateStore;
}): Promise<void> {
  const { commandContext, loadConfig, resolveCredentials, usageState } = options;
  const loaded = loadConfig();
  const credentials = await resolveCredentials(commandContext);
  notify(
    commandContext,
    formatDiagnosticsReport({
      loaded,
      credentials,
      usageState,
      runtime: commandContext,
    }),
  );
}

function isSubcommandInvocation(loweredArgs: string, subcommand: string): boolean {
  return loweredArgs === subcommand || loweredArgs.startsWith(`${subcommand} `);
}

function isRemovedSetInvocation(loweredArgs: string): boolean {
  return isSubcommandInvocation(loweredArgs, "set");
}

function removedShowPathText(): string {
  return [
    "The /openai-usage-settings show path was removed.",
    "Common settings are interactive through no-args /openai-usage-settings when UI is available.",
    "Use /openai-usage-settings help for supported utility subcommands.",
  ].join("\n");
}

function removedDebugPathText(): string {
  return [
    "The /openai-usage-settings debug path is not a diagnostics alias.",
    "Use /openai-usage-settings diagnostics for diagnostics.",
    "Use /openai-usage-settings help for supported utility subcommands.",
  ].join("\n");
}

function removedSetPathText(): string {
  return [
    "Slash-command setting writes were removed.",
    "Common settings are interactive now through no-args /openai-usage-settings when UI is available.",
    "Advanced settings can be edited in the JSON config file.",
    "Use /openai-usage-settings help for supported utility subcommands.",
  ].join("\n");
}

function usageSettingsNoUiFallbackText(): string {
  return [
    "Interactive settings require UI.",
    "This non-UI fallback is read-only and does not change configuration.",
    "Supported utility subcommands:",
    "  /openai-usage-settings usage",
    "  /openai-usage-settings refresh",
    "  /openai-usage-settings diagnostics",
    "  /openai-usage-settings help",
  ].join("\n");
}

function usageSettingsHelpText(): string {
  return [
    "/openai-usage-settings is the only OpenAI usage/settings command.",
    "Common settings are interactive through no-args /openai-usage-settings when UI is available.",
    "Advanced settings are JSON-file-only in the usage config file.",
    "",
    "Supported utility subcommands:",
    "  usage        Show cached usage and refresh when stale or missing",
    "  refresh      Force a usage refresh",
    "  diagnostics  Show runtime, auth, config, and raw-config diagnostics",
    "  help         Show this help",
  ].join("\n");
}

const SUPPORTED_UTILITY_SUBCOMMANDS = ["usage", "refresh", "diagnostics", "help"] as const;

function suggestSettingsSubcommands(argumentPrefix: string) {
  const prefix = argumentPrefix.trim().toLowerCase();
  const matches = SUPPORTED_UTILITY_SUBCOMMANDS
    .filter((command) => command.startsWith(prefix))
    .map((command) => ({
      value: command,
      label: command,
    }));
  return matches.length > 0 ? matches : null;
}

function asUsageSettingsContext(ctx: ExtensionCommandContext): UsageSettingsCommandContext {
  return ctx as UsageSettingsCommandContext;
}

function notify(ctx: UsageSettingsCommandContext, message: string): void {
  ctx.ui.notify(message, "info");
}

function noopConfigChanged(_ctx: UsageSettingsCommandContext): void {
  return undefined;
}

function noopStatusLineReapply(_ctx: UsageSettingsCommandContext): void {
  return undefined;
}

function defaultResolveCredentials(
  ctx: UsageSettingsCommandContext,
): Promise<CodexCredentialResolution> {
  return resolveCodexOAuthCredentials({ modelRegistry: ctx.modelRegistry });
}
