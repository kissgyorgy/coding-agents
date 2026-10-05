import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  resolveCodexOAuthCredentials,
  type CodexCredentialResolution,
  type CodexModelRegistry,
} from "./auth";
import { type LoadedUsageConfig, type UsageConfig, loadUsageConfig } from "./config";
import type { UsageColorTheme } from "./color";
import {
  appendUsageRefreshFailureMarker,
  formatUsageAuthFailedStatusLine,
  formatUsageLoginRequiredStatusLine,
  formatUsageRefreshFailedStatusLine,
  formatUsageStatusLine,
} from "./format";
import { fetchCodexUsage, type UsageClientPort, type UsageFetchError } from "./usage-client";
import { createUsageRefreshCoordinator, type UsageRefreshCoordinator } from "./usage-refresh-coordinator";
import { createUsageStateStore, type UsageStateStore } from "./usage-state";
import { decideUsageVisibility, type UsageModel, type UsageModelRegistry } from "./visibility";

export const USAGE_STATUS_KEY = "openai-usage";

export type StatusLineContext = {
  model?: UsageModel;
  modelRegistry?: UsageModelRegistry & CodexModelRegistry;
  signal?: AbortSignal;
  ui: {
    setStatus(key: string, text: string | undefined): void;
    theme?: UsageColorTheme;
  };
};

type TimerHandle = unknown;

export type TimerApi = {
  setInterval(handler: () => void, delayMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

export type UsageStatusControllerDependencies = {
  loadConfig?: () => LoadedUsageConfig;
  timerApi?: TimerApi;
  resolveCredentials?: (
    ctx: StatusLineContext,
  ) => CodexCredentialResolution | Promise<CodexCredentialResolution>;
  usageClient?: UsageClientPort;
  usageState?: UsageStateStore;
  usageRefreshCoordinator?: UsageRefreshCoordinator;
};

export type UsageStatusController = {
  reapply(ctx: StatusLineContext): Promise<void>;
};

const defaultTimerApi: TimerApi = {
  setInterval(handler, delayMs) {
    const handle = setInterval(handler, delayMs);
    handle.unref?.();
    return handle;
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

const defaultUsageClient: UsageClientPort = {
  fetchUsage: fetchCodexUsage,
};

/**
 * Registers lifecycle ownership for the Usage Status Extension's status-line entry.
 */
export function registerUsageStatusController(
  pi: ExtensionAPI,
  dependencies: UsageStatusControllerDependencies = {},
): UsageStatusController {
  const loadConfig = dependencies.loadConfig ?? loadUsageConfig;
  const timerApi = dependencies.timerApi ?? defaultTimerApi;
  const resolveCredentials = dependencies.resolveCredentials ?? defaultResolveCredentials;
  const usageClient = dependencies.usageClient ?? defaultUsageClient;
  const usageState = dependencies.usageState ?? createUsageStateStore();
  const refreshCoordinator =
    dependencies.usageRefreshCoordinator ??
    createUsageRefreshCoordinator({ usageClient, usageState });
  let refreshTimer: TimerHandle | undefined;
  let refreshTimerDelayMs: number | undefined;
  let activeApplyId = 0;

  pi.on("session_start", async (_event, ctx) => {
    await applyCurrentConfiguration(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await applyCurrentConfiguration(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await applyCurrentConfiguration(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopRefreshTimer();
    refreshCoordinator.abortInFlightRefresh();
    activeApplyId += 1;
    clearUsageStatus(ctx);
  });

  async function applyCurrentConfiguration(ctx: StatusLineContext): Promise<void> {
    const applyId = ++activeApplyId;

    const { effective: initialConfig } = loadConfig();

    if (!isCurrentApply(applyId)) {
      return;
    }
    if (!initialConfig.enabled) {
      stopRefreshTimer();
      clearUsageStatus(ctx);
      return;
    }

    const initialVisibility = decideUsageVisibility({
      showAlways: initialConfig.display.showAlways,
      model: ctx.model,
      modelRegistry: ctx.modelRegistry,
    });

    if (!initialVisibility.visible) {
      stopRefreshTimer();
      clearUsageStatus(ctx);
      return;
    }

    const credentials = await resolveCredentials(ctx);
    if (!isCurrentApply(applyId)) {
      return;
    }
    if (!credentials.ok) {
      stopRefreshTimer();
      publishLoginRequiredStatus(ctx);
      return;
    }

    const hadCachedSnapshot = usageState.getSnapshot(ctx.model?.id) !== undefined;
    if (hadCachedSnapshot && isCurrentApply(applyId)) {
      publishUsageStatus(ctx, initialConfig, usageState);
    }

    const refreshResult = await refreshCoordinator.refresh({
      credentials: credentials.credentials,
      signal: ctx.signal,
      modelId: ctx.model?.id,
      staleAfterMs: initialConfig.refreshIntervalMs,
    });

    if (!isCurrentApply(applyId)) {
      return;
    }

    const latestConfig = loadConfig().effective;

    const latestVisibility = decideUsageVisibility({
      showAlways: latestConfig.display.showAlways,
      model: ctx.model,
      modelRegistry: ctx.modelRegistry,
    });

    if (!latestConfig.enabled || !latestVisibility.visible) {
      stopRefreshTimer();
      clearUsageStatus(ctx);
      return;
    }

    if (refreshResult.status === "failed") {
      publishRefreshFailureStatus(ctx, latestConfig, refreshResult.error, hadCachedSnapshot);
    } else if (refreshResult.status !== "skipped" || hadCachedSnapshot) {
      publishUsageStatus(ctx, latestConfig, usageState);
    }

    ensureRefreshTimer(ctx, latestConfig.refreshIntervalMs);
  }

  function publishRefreshFailureStatus(
    ctx: StatusLineContext,
    config: UsageConfig,
    error: UsageFetchError,
    hadCachedSnapshot: boolean,
  ): void {
    if (error.kind === "auth") {
      publishUsageAuthFailedStatus(ctx);
      return;
    }

    if (hadCachedSnapshot) {
      const failedCachedText = formatUsageStatusLine({
        snapshot: usageState.getSnapshot(ctx.model?.id),
        config,
        theme: ctx.ui.theme,
      });
      if (failedCachedText !== undefined) {
        publishRefreshFailedStatus(ctx, failedCachedText);
        return;
      }
    }

    publishUsageRefreshFailedStatus(ctx);
  }

  function isCurrentApply(applyId: number): boolean {
    return applyId === activeApplyId;
  }

  function ensureRefreshTimer(ctx: StatusLineContext, delayMs: number): void {
    if (refreshTimer !== undefined && refreshTimerDelayMs === delayMs) return;

    stopRefreshTimer();
    refreshTimer = timerApi.setInterval(() => {
      void applyCurrentConfiguration(ctx);
    }, delayMs);
    refreshTimerDelayMs = delayMs;
  }

  function stopRefreshTimer(): void {
    if (refreshTimer === undefined) return;

    timerApi.clearInterval(refreshTimer);
    refreshTimer = undefined;
    refreshTimerDelayMs = undefined;
  }

  return {
    reapply: applyCurrentConfiguration,
  };
}

async function defaultResolveCredentials(
  ctx: StatusLineContext,
): Promise<CodexCredentialResolution> {
  return resolveCodexOAuthCredentials({ modelRegistry: ctx.modelRegistry });
}

function publishUsageStatus(
  ctx: StatusLineContext,
  config: UsageConfig,
  usageState: UsageStateStore,
): void {
  const statusText = formatUsageStatusLine({
    snapshot: usageState.getSnapshot(ctx.model?.id),
    config,
    theme: ctx.ui.theme,
  });

  if (statusText === undefined || statusText.length === 0) {
    clearUsageStatus(ctx);
    return;
  }

  ctx.ui.setStatus(USAGE_STATUS_KEY, statusText);
}

function publishLoginRequiredStatus(ctx: StatusLineContext): void {
  ctx.ui.setStatus(USAGE_STATUS_KEY, formatUsageLoginRequiredStatusLine(ctx.ui.theme));
}

function publishUsageAuthFailedStatus(ctx: StatusLineContext): void {
  ctx.ui.setStatus(USAGE_STATUS_KEY, formatUsageAuthFailedStatusLine(ctx.ui.theme));
}

function publishRefreshFailedStatus(ctx: StatusLineContext, statusText: string): void {
  ctx.ui.setStatus(USAGE_STATUS_KEY, appendUsageRefreshFailureMarker(statusText, ctx.ui.theme));
}

function publishUsageRefreshFailedStatus(ctx: StatusLineContext): void {
  ctx.ui.setStatus(USAGE_STATUS_KEY, formatUsageRefreshFailedStatusLine(ctx.ui.theme));
}

function clearUsageStatus(ctx: StatusLineContext): void {
  ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
}
