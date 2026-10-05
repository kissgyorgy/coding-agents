import type { CodexCredentialResolution } from "./auth";
import type { LoadedUsageConfig } from "./config";
import { USAGE_ENDPOINT, type UsageFetchError } from "./usage-client";
import type { UsageStateStore } from "./usage-state";

export type DiagnosticsRuntime = {
  hasUI?: boolean;
  model?: {
    provider?: string;
    id?: string;
  };
  signal?: {
    aborted?: boolean;
  };
};

export type DiagnosticsReportInput = {
  loaded: LoadedUsageConfig;
  credentials: CodexCredentialResolution;
  usageState: UsageStateStore;
  runtime?: DiagnosticsRuntime;
  endpoint?: string;
};

export type RedactedDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | RedactedDiagnosticValue[]
  | { [key: string]: RedactedDiagnosticValue };

const REDACTED = "<redacted>";

export function formatDiagnosticsReport(input: DiagnosticsReportInput): string {
  return ["openai-usage diagnostics", ...formatDiagnosticsLines(input)].join("\n");
}

export function formatDiagnosticsLines(input: DiagnosticsReportInput): string[] {
  const { loaded, credentials, usageState, runtime } = input;
  const endpoint = input.endpoint ?? USAGE_ENDPOINT;

  return [
    "Diagnostics:",
    `  Config path: ${loaded.configPath}`,
    `  Project config path: ${loaded.projectConfigPath}`,
    `  Global config path: ${loaded.globalConfigPath}`,
    `  Project config exists: ${formatBooleanText(loaded.projectConfigExists)}`,
    `  Global config exists: ${formatBooleanText(loaded.globalConfigExists)}`,
    `  Endpoint: ${endpoint}`,
    "  Runtime:",
    `    UI available: ${formatBooleanText(runtime?.hasUI === true)}`,
    `    Model provider: ${formatOptionalText(runtime?.model?.provider)}`,
    `    Model ID: ${formatOptionalText(runtime?.model?.id)}`,
    `    Signal aborted: ${formatBooleanText(runtime?.signal?.aborted === true)}`,
    `  Last fetch: ${formatDateTime(usageState.getLastAttemptAt())}`,
    `  Last success: ${formatDateTime(usageState.getLastSuccessAt())}`,
    `  Last error: ${formatLastError(usageState.getLastError())}`,
    `  Auth source: ${credentials.diagnostics.source}`,
    `  Checked auth sources: ${credentials.diagnostics.checkedSources.join(", ") || "<none>"}`,
    `  Has access token: ${formatBooleanText(credentials.diagnostics.hasAccessToken)}`,
    `  Has account ID: ${formatBooleanText(credentials.diagnostics.hasAccountId)}`,
    `  Account ID: ${credentials.diagnostics.accountId ?? "<redacted or missing>"}`,
    ...formatCredentialDetails(credentials),
    `  Effective enabled: ${formatBooleanText(loaded.effective.enabled)}`,
    `  Effective refresh interval (ms): ${loaded.effective.refreshIntervalMs}`,
    `  Config enabled: ${formatBooleanText(loaded.effective.enabled)}`,
    `  Refresh interval (ms): ${loaded.effective.refreshIntervalMs}`,
    ...formatJsonBlock("  Raw project config:", loaded.raw.project),
    ...formatJsonBlock("  Raw global config:", loaded.raw.global),
  ];
}

export function redactDiagnosticValue(
  value: unknown,
  keyPath: readonly string[] = [],
): RedactedDiagnosticValue {
  const key = keyPath.at(-1);
  if (key !== undefined && isSensitiveKey(key)) {
    return REDACTED;
  }

  if (value === null) return null;

  if (typeof value === "string") {
    return redactDiagnosticString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticValue(entry, keyPath));
  }

  if (isRecord(value)) {
    const redacted: { [key: string]: RedactedDiagnosticValue } = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      redacted[childKey] = redactDiagnosticValue(childValue, [...keyPath, childKey]);
    }
    return redacted;
  }

  return value === undefined ? null : String(value);
}

function formatCredentialDetails(credentials: CodexCredentialResolution): string[] {
  if (!credentials.ok) {
    return [`  Credential error: ${redactDiagnosticString(credentials.error.message)}`];
  }

  const redactedCredentials = credentials.toJSON().credentials;
  return [
    `  Credential source: ${redactedCredentials.source}`,
    `  Credential account ID (redacted): ${redactedCredentials.accountId}`,
  ];
}

function formatJsonBlock(label: string, value: Record<string, unknown>): string[] {
  const redacted = redactDiagnosticValue(value);
  const serialized = JSON.stringify(redacted, null, 2) ?? "null";
  return [label, ...serialized.split("\n").map((line) => `  ${line}`)];
}

function formatDateTime(value: Date | undefined): string {
  return value === undefined ? "<none>" : value.toISOString();
}

function formatLastError(error: UsageFetchError | undefined): string {
  if (error === undefined) return "<none>";
  const message = redactDiagnosticString(error.message);
  if (error.status === undefined) {
    return `${error.kind}: ${message}`;
  }
  return `${error.kind} (${error.status}): ${message}`;
}

function formatBooleanText(value: boolean): string {
  return value ? "yes" : "no";
}

function formatOptionalText(value: string | undefined): string {
  return value === undefined || value.trim().length === 0 ? "<none>" : redactDiagnosticString(value);
}

function redactDiagnosticString(value: string): string {
  let redacted = value.replace(
    /\bBearer\s+([A-Za-z0-9._~+/=-]+)/giu,
    "Bearer <redacted>",
  );

  redacted = redacted.replace(
    /\b(access[_ -]?token|refresh[_ -]?token|bearer[_ -]?token|api[_ -]?key|authorization|token)\b(\s*[:=]\s*)(["']?)([^"'\s,;]+)/giu,
    (_match, label: string, separator: string, quote: string, _secret: string) =>
      `${label}${separator}${quote}${REDACTED}${quote}`,
  );

  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/giu, REDACTED);
  redacted = redacted.replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/giu, REDACTED);
  redacted = redacted.replace(
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
    REDACTED,
  );
  redacted = redacted.replace(
    /\b[A-Za-z0-9_-]*(?:token|secret|api-key|apikey)[A-Za-z0-9_-]*\b/giu,
    (match) => (match.length >= 8 ? REDACTED : match),
  );

  return isLikelyOpaqueToken(redacted) ? REDACTED : redacted;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (
    normalized.includes("token") ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized === "access" ||
    normalized === "authorization" ||
    normalized === "bearer" ||
    normalized === "key" ||
    normalized === "accountid"
  );
}

function isLikelyOpaqueToken(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 20) return false;
  if (!/^[A-Za-z0-9._~+/=-]+$/u.test(trimmed)) return false;
  return /[A-Za-z]/u.test(trimmed) && /\d/u.test(trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
