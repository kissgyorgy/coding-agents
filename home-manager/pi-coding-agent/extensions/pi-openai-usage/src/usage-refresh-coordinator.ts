import type { UsageClientPort, UsageFetchError, UsageRequestCredentials } from "./usage-client";
import { createUsageStateStore, type UsageStateStore } from "./usage-state";
import { parseUsageSnapshot, type UsageSnapshot } from "./usage-snapshot";

export type UsageRefreshOptions = {
  credentials: UsageRequestCredentials;
  signal?: AbortSignal;
  modelId?: string;
  staleAfterMs?: number;
  force?: boolean;
};

export type UsageRefreshResult =
  | {
      status: "refreshed";
      joined: boolean;
      snapshot: UsageSnapshot;
      fetchedAt: Date;
    }
  | {
      status: "skipped";
      reason: "fresh";
      joined: false;
      snapshot: UsageSnapshot | undefined;
    }
  | {
      status: "failed";
      joined: boolean;
      error: UsageFetchError;
      snapshot: UsageSnapshot | undefined;
      attemptedAt: Date;
    };

export type UsageRefreshCoordinator = {
  refresh(options: UsageRefreshOptions): Promise<UsageRefreshResult>;
  isRefreshing(): boolean;
  abortInFlightRefresh(): void;
};

export type UsageRefreshCoordinatorDependencies = {
  usageClient: UsageClientPort;
  usageState?: UsageStateStore;
  now?: () => Date;
};

type InFlightRefreshResult =
  | {
      status: "refreshed";
      raw: unknown;
      fetchedAt: Date;
    }
  | {
      status: "failed";
      error: UsageFetchError;
      attemptedAt: Date;
    };

export function createUsageRefreshCoordinator(
  dependencies: UsageRefreshCoordinatorDependencies,
): UsageRefreshCoordinator {
  const usageState = dependencies.usageState ?? createUsageStateStore();
  const now = dependencies.now ?? (() => new Date());
  let inFlightRefresh: Promise<InFlightRefreshResult> | undefined;
  let inFlightAbortController: AbortController | undefined;

  async function refresh(options: UsageRefreshOptions): Promise<UsageRefreshResult> {
    if (inFlightRefresh !== undefined) {
      return materializeRefreshResult(usageState, await inFlightRefresh, true, options.modelId);
    }

    if (!options.force && !isCachedSnapshotStale(usageState, options.staleAfterMs, now())) {
      return {
        status: "skipped",
        reason: "fresh",
        joined: false,
        snapshot: usageState.getSnapshot(options.modelId),
      };
    }

    const ownerAbort = new AbortController();
    inFlightAbortController = ownerAbort;
    const cleanupAbortForwarder = pipeExternalAbortSignal(options.signal, ownerAbort);
    const ownerRefresh = runRefresh(options, ownerAbort.signal);
    inFlightRefresh = ownerRefresh;

    try {
      return materializeRefreshResult(usageState, await ownerRefresh, false, options.modelId);
    } finally {
      inFlightAbortController = undefined;
      cleanupAbortForwarder();
      if (inFlightRefresh === ownerRefresh) {
        inFlightRefresh = undefined;
      }
    }
  }

  async function runRefresh(
    options: UsageRefreshOptions,
    signal: AbortSignal,
  ): Promise<InFlightRefreshResult> {
    const attemptedAt = now();
    usageState.recordFetchAttempt(attemptedAt);

    const result = await dependencies.usageClient.fetchUsage(options.credentials, { signal });

    if (!result.ok) {
      usageState.recordFetchError(result.error, attemptedAt);
      return {
        status: "failed",
        error: result.error,
        attemptedAt,
      };
    }

    const fetchedAt = now();
    usageState.storeRawUsageResponse(result.raw, fetchedAt);

    return {
      status: "refreshed",
      raw: result.raw,
      fetchedAt,
    };
  }

  return {
    refresh,
    isRefreshing() {
      return inFlightRefresh !== undefined;
    },
    abortInFlightRefresh() {
      inFlightAbortController?.abort();
    },
  };
}

function isCachedSnapshotStale(
  usageState: UsageStateStore,
  staleAfterMs: number | undefined,
  now: Date,
): boolean {
  if (usageState.getSnapshot() === undefined) return true;

  const lastSuccessAt = usageState.getLastSuccessAt();
  if (lastSuccessAt === undefined) return true;
  if (staleAfterMs === undefined) return true;

  return now.getTime() - lastSuccessAt.getTime() >= staleAfterMs;
}

function materializeRefreshResult(
  usageState: UsageStateStore,
  result: InFlightRefreshResult,
  joined: boolean,
  modelId: string | undefined,
): UsageRefreshResult {
  if (result.status === "failed") {
    return {
      status: "failed",
      joined,
      error: result.error,
      snapshot: usageState.getSnapshot(modelId),
      attemptedAt: result.attemptedAt,
    };
  }

  return {
    status: "refreshed",
    joined,
    snapshot: parseUsageSnapshot(result.raw, { modelId }),
    fetchedAt: result.fetchedAt,
  };
}

function pipeExternalAbortSignal(
  signal: AbortSignal | undefined,
  internalController: AbortController,
): () => void {
  if (signal === undefined) {
    return () => undefined;
  }

  const abort = (): void => {
    internalController.abort(signal.reason);
  };

  if (signal.aborted) {
    abort();
    return () => undefined;
  }

  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}
