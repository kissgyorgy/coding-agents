import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { resolveCodexOAuthCredentials, type CodexCredentialResolution } from "./auth";
import { type LoadedUsageConfig, loadUsageConfig, type UsageConfig } from "./config";
import {
  appendUsageRefreshFailureMarker,
  formatUsageAuthFailedStatusLine,
  formatUsageLoginRequiredStatusLine,
  formatUsageRefreshFailedStatusLine,
  formatUsageStatusLine,
} from "./format";
import type { UsageRefreshCoordinator, UsageRefreshResult } from "./usage-refresh-coordinator";

export type UsageCommandFacadeContext = Pick<
  ExtensionCommandContext,
  "ui" | "model" | "modelRegistry" | "signal"
>;

export type UsageCommandFacadeDependencies = {
  loadConfig?: () => LoadedUsageConfig;
  resolveCredentials?: (
    ctx: UsageCommandFacadeContext,
  ) => Promise<CodexCredentialResolution>;
  usageRefreshCoordinator: UsageRefreshCoordinator;
};

export type ShowUsageOptions = {
  forceRefresh?: boolean;
};

export type UsageCommandFacade = {
  showUsage(ctx: UsageCommandFacadeContext, options?: ShowUsageOptions): Promise<void>;
};

export function createUsageCommandFacade(
  dependencies: UsageCommandFacadeDependencies,
): UsageCommandFacade {
  const loadConfig = dependencies.loadConfig ?? loadUsageConfig;
  const resolveCredentials = dependencies.resolveCredentials ?? defaultResolveCredentials;
  const usageRefreshCoordinator = dependencies.usageRefreshCoordinator;

  return {
    async showUsage(ctx, options = {}) {
      const initialConfig = loadConfig().effective;
      const credentials = await resolveCredentials(ctx);
      if (!credentials.ok) {
        notify(ctx, formatUsageLoginRequiredStatusLine());
        return;
      }

      const refreshResult = await usageRefreshCoordinator.refresh({
        credentials: credentials.credentials,
        signal: ctx.signal,
        modelId: ctx.model?.id,
        staleAfterMs: initialConfig.refreshIntervalMs,
        force: options.forceRefresh,
      });

      const latestConfig = loadConfig().effective;
      const statusText = resolveUsageStatusText(latestConfig, refreshResult, ctx.ui.theme);
      notify(ctx, statusText ?? formatUsageRefreshFailedStatusLine());
    },
  };
}

function resolveUsageStatusText(
  config: UsageConfig,
  refreshResult: UsageRefreshResult,
  theme?: UsageCommandFacadeContext["ui"]["theme"],
): string | undefined {
  if (refreshResult.status === "failed") {
    if (refreshResult.error.kind === "auth") {
      return formatUsageAuthFailedStatusLine();
    }

    const cachedText = formatUsageStatusLine({
      snapshot: refreshResult.snapshot,
      config,
      theme,
    });
    if (cachedText !== undefined) {
      return appendUsageRefreshFailureMarker(cachedText, theme);
    }

    return formatUsageRefreshFailedStatusLine();
  }

  return formatUsageStatusLine({
    snapshot: refreshResult.snapshot,
    config,
    theme,
  });
}

function notify(ctx: UsageCommandFacadeContext, message: string): void {
  ctx.ui.notify(message, "info");
}

function defaultResolveCredentials(
  ctx: UsageCommandFacadeContext,
): Promise<CodexCredentialResolution> {
  return resolveCodexOAuthCredentials({ modelRegistry: ctx.modelRegistry });
}
