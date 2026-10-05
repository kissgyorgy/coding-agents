export const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
export const DEFAULT_USAGE_REQUEST_TIMEOUT_MS = 10_000;

export type UsageRequestCredentials = {
  accessToken: string;
  accountId: string;
};

export type UsageFetchErrorKind = "auth" | "http" | "network" | "timeout" | "aborted" | "parse";

export type UsageFetchError = {
  kind: UsageFetchErrorKind;
  message: string;
  status?: number;
};

export type UsageFetchResult =
  | { ok: true; raw: unknown; status: number }
  | { ok: false; error: UsageFetchError };

export type FetchCodexUsageOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type UsageClientPort = {
  fetchUsage(
    credentials: UsageRequestCredentials,
    options?: Pick<FetchCodexUsageOptions, "signal">,
  ): Promise<UsageFetchResult>;
};

const TIMEOUT_ABORT_MARKER = Symbol("usage request timeout");
const EXTERNAL_ABORT_MARKER = Symbol("usage request aborted");

export async function fetchCodexUsage(
  credentials: UsageRequestCredentials,
  options: FetchCodexUsageOptions = {},
): Promise<UsageFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_USAGE_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let abortReason: typeof TIMEOUT_ABORT_MARKER | typeof EXTERNAL_ABORT_MARKER | undefined;

  const timeoutHandle = setTimeout(() => {
    abortReason ??= TIMEOUT_ABORT_MARKER;
    controller.abort(TIMEOUT_ABORT_MARKER);
  }, timeoutMs);
  timeoutHandle.unref?.();

  const removeExternalAbortListener = pipeExternalAbort(options.signal, controller, () => {
    abortReason ??= EXTERNAL_ABORT_MARKER;
  });

  try {
    const response = await fetchImpl(USAGE_ENDPOINT, {
      headers: {
        accept: "*/*",
        authorization: `Bearer ${credentials.accessToken}`,
        "chatgpt-account-id": credentials.accountId,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: classifyHttpError(response.status),
      };
    }

    try {
      return {
        ok: true,
        raw: await response.json(),
        status: response.status,
      };
    } catch {
      return {
        ok: false,
        error: { kind: "parse", message: "Codex usage response was not valid JSON" },
      };
    }
  } catch (error) {
    return { ok: false, error: classifyThrownError(error, abortReason) };
  } finally {
    clearTimeout(timeoutHandle);
    removeExternalAbortListener();
  }
}

function classifyHttpError(status: number): UsageFetchError {
  if (status === 401 || status === 403) {
    return { kind: "auth", status, message: `Codex usage authentication failed (${status})` };
  }

  return { kind: "http", status, message: `Codex usage request failed (${status})` };
}

function classifyThrownError(
  error: unknown,
  abortReason: typeof TIMEOUT_ABORT_MARKER | typeof EXTERNAL_ABORT_MARKER | undefined,
): UsageFetchError {
  if (abortReason === TIMEOUT_ABORT_MARKER) {
    return { kind: "timeout", message: "Codex usage request timed out" };
  }

  if (abortReason === EXTERNAL_ABORT_MARKER || isAbortError(error)) {
    return { kind: "aborted", message: "Codex usage request was aborted" };
  }

  return { kind: "network", message: messageFromUnknownError(error) };
}

function pipeExternalAbort(
  externalSignal: AbortSignal | undefined,
  controller: AbortController,
  onAbort: () => void,
): () => void {
  if (externalSignal === undefined) return () => undefined;

  const abort = () => {
    onAbort();
    controller.abort(EXTERNAL_ABORT_MARKER);
  };

  if (externalSignal.aborted) {
    abort();
    return () => undefined;
  }

  externalSignal.addEventListener("abort", abort, { once: true });
  return () => externalSignal.removeEventListener("abort", abort);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function messageFromUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Codex usage request failed";
}
