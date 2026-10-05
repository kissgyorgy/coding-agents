import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerOpenAIUsageSettingsCommand } from "./src/usage-settings";
import {
  createUsageRefreshCoordinator,
  type UsageRefreshCoordinator,
} from "./src/usage-refresh-coordinator";
import { createUsageStateStore } from "./src/usage-state";
import { fetchCodexUsage, type UsageClientPort } from "./src/usage-client";
import { registerUsageStatusController } from "./src/status-controller";

export default function piOpenAIUsage(pi: ExtensionAPI): void {
  const usageClient: UsageClientPort = { fetchUsage: fetchCodexUsage };
  const usageState = createUsageStateStore();
  const usageRefreshCoordinator: UsageRefreshCoordinator = createUsageRefreshCoordinator({
    usageClient,
    usageState,
  });

  const statusController = registerUsageStatusController(pi, {
    usageClient,
    usageState,
    usageRefreshCoordinator,
  });
  if (typeof (pi as { registerCommand?: unknown }).registerCommand === "function") {
    registerOpenAIUsageSettingsCommand(pi, {
      usageState,
      usageRefreshCoordinator,
      reapplyStatusLine: (ctx) => statusController.reapply(ctx),
    });
  }
}
