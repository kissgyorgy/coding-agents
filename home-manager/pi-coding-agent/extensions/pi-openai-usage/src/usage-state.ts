import type { UsageFetchError } from "./usage-client";
import { parseUsageSnapshot, type UsageSnapshot } from "./usage-snapshot";

export type UsageStateStore = {
  getSnapshot(modelId?: string): UsageSnapshot | undefined;
  storeSnapshot(snapshot: UsageSnapshot, fetchedAt?: Date): void;
  storeRawUsageResponse(rawResponse: unknown, fetchedAt?: Date): void;
  getLastAttemptAt(): Date | undefined;
  getLastSuccessAt(): Date | undefined;
  getLastError(): UsageFetchError | undefined;
  getCurrentError(): UsageFetchError | undefined;
  recordFetchAttempt(at?: Date): void;
  recordFetchError(error: UsageFetchError, attemptedAt?: Date): void;
};

export function createUsageStateStore(): UsageStateStore {
  let snapshot: UsageSnapshot | undefined;
  let rawUsageResponse: unknown | undefined;
  let lastAttemptAt: Date | undefined;
  let lastSuccessAt: Date | undefined;
  let lastError: UsageFetchError | undefined;
  let currentError: UsageFetchError | undefined;

  return {
    getSnapshot(modelId) {
      if (rawUsageResponse !== undefined) {
        return parseUsageSnapshot(rawUsageResponse, { modelId });
      }
      return snapshot;
    },
    storeSnapshot(nextSnapshot, fetchedAt = new Date()) {
      snapshot = nextSnapshot;
      rawUsageResponse = undefined;
      lastAttemptAt = fetchedAt;
      lastSuccessAt = fetchedAt;
      currentError = undefined;
    },
    storeRawUsageResponse(nextRawUsageResponse, fetchedAt = new Date()) {
      rawUsageResponse = nextRawUsageResponse;
      snapshot = parseUsageSnapshot(nextRawUsageResponse);
      lastAttemptAt = fetchedAt;
      lastSuccessAt = fetchedAt;
      currentError = undefined;
    },
    getLastAttemptAt() {
      return lastAttemptAt;
    },
    getLastSuccessAt() {
      return lastSuccessAt;
    },
    getLastError() {
      return lastError;
    },
    getCurrentError() {
      return currentError;
    },
    recordFetchAttempt(at = new Date()) {
      lastAttemptAt = at;
    },
    recordFetchError(error, attemptedAt = new Date()) {
      lastAttemptAt = attemptedAt;
      currentError = error;
      lastError = error;
    },
  };
}
