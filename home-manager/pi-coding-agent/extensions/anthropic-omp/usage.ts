import type { FetchFunction } from "@earendil-works/pi-ai";
import { API_ORIGIN, isRecord, oauthHeaders, tokenKey } from "./transport.ts";

export interface UsageWindow {
  id: string;
  label: string;
  percent?: number;
  resetsAt?: number;
}

export interface UsageReport {
  fetchedAt: number;
  source: "usage endpoint" | "response headers";
  windows: UsageWindow[];
  extra?: { enabled?: boolean; used?: number; limit?: number };
  overageInUse?: boolean;
}

interface UsageResult {
  report?: UsageReport;
  warning?: string;
}

interface CacheEntry extends UsageResult {
  observed?: UsageReport;
  nextPollAt: number;
  pending?: Promise<UsageResult>;
}

function number(value: unknown): number | undefined {
  if (typeof value === "string" && !value.trim()) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function resetAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function window(
  id: string,
  label: string,
  value: unknown,
): UsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const percent = number(value.utilization ?? value.percent);
  const resetsAt = resetAt(value.resets_at);
  if (percent === undefined && resetsAt === undefined) return undefined;
  return { id, label, percent, resetsAt };
}

function dollars(value: unknown, legacy = false): number | undefined {
  if (!isRecord(value)) return undefined;
  if (
    (value.currency === undefined && !legacy) ||
    (value.currency !== undefined &&
      (typeof value.currency !== "string" ||
        value.currency.toUpperCase() !== "USD"))
  )
    return undefined;
  const amount = value.amount_minor;
  const exponent = value.exponent;
  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    typeof exponent !== "number" ||
    !Number.isSafeInteger(exponent) ||
    exponent < 0 ||
    exponent > 20
  )
    return undefined;
  return amount / 10 ** exponent;
}

export function parseUsage(payload: unknown, now = Date.now()): UsageReport {
  if (!isRecord(payload)) throw new Error("Claude returned invalid usage data");
  const limits = Array.isArray(payload.limits)
    ? payload.limits.filter(isRecord)
    : [];
  const windows = [
    window("5h", "5 hour", payload.five_hour) ??
      window(
        "5h",
        "5 hour",
        limits.find((entry) => entry.kind === "session"),
      ),
    window("7d", "7 day", payload.seven_day) ??
      window(
        "7d",
        "7 day",
        limits.find((entry) => entry.kind === "weekly_all"),
      ),
  ].filter((entry): entry is UsageWindow => entry !== undefined);
  const scoped = limits.filter((entry) => entry.kind === "weekly_scoped");
  for (const entry of scoped) {
    const model = isRecord(entry.scope) ? entry.scope.model : undefined;
    const name = isRecord(model) ? model.display_name : undefined;
    if (typeof name !== "string" || !name.trim()) continue;
    const parsed = window(`7d:${name.toLowerCase()}`, `7 day (${name})`, entry);
    if (parsed) windows.push(parsed);
  }
  for (const family of ["opus", "sonnet"]) {
    if (windows.some((entry) => entry.id === `7d:${family}`)) continue;
    const parsed = window(
      `7d:${family}`,
      `7 day (${family})`,
      payload[`seven_day_${family}`],
    );
    if (parsed) windows.push(parsed);
  }

  let extra: UsageReport["extra"];
  // A present spend object is authoritative, including when it disables overage.
  if (payload.spend !== null && payload.spend !== undefined) {
    if (isRecord(payload.spend)) {
      extra = {
        enabled:
          typeof payload.spend.enabled === "boolean"
            ? payload.spend.enabled
            : undefined,
        used: dollars(payload.spend.used),
        limit: dollars(payload.spend.limit),
      };
    }
  } else if (isRecord(payload.extra_usage)) {
    const legacy = payload.extra_usage;
    const amount = (value: unknown) =>
      dollars(
        {
          amount_minor: value,
          exponent: legacy.decimal_places ?? 2,
          currency: legacy.currency,
        },
        true,
      );
    extra = {
      enabled:
        typeof legacy.is_enabled === "boolean" ? legacy.is_enabled : undefined,
      used: amount(legacy.used_credits),
      limit: amount(legacy.monthly_limit),
    };
  }
  if (windows.length === 0 && extra === undefined) {
    throw new Error(
      "Claude did not report subscription or extra-usage counters",
    );
  }
  return { fetchedAt: now, source: "usage endpoint", windows, extra };
}

export function parseUsageHeaders(
  headers: Headers,
  now = Date.now(),
): UsageReport | undefined {
  const windows: UsageWindow[] = [];
  for (const [id, label] of [
    ["5h", "5 hour"],
    ["7d", "7 day"],
  ]) {
    const prefix = `anthropic-ratelimit-unified-${id}-`;
    const fraction = number(headers.get(`${prefix}utilization`));
    const resetSeconds = number(headers.get(`${prefix}reset`));
    if (fraction === undefined && resetSeconds === undefined) continue;
    windows.push({
      id,
      label,
      percent: fraction === undefined ? undefined : fraction * 100,
      resetsAt: resetSeconds === undefined ? undefined : resetSeconds * 1000,
    });
  }
  const rawOverage = headers.get("anthropic-ratelimit-unified-overage-in-use");
  const overageInUse =
    rawOverage === "true" ? true : rawOverage === "false" ? false : undefined;
  if (windows.length === 0 && overageInUse === undefined) return undefined;
  return { fetchedAt: now, source: "response headers", windows, overageInUse };
}

export class UsageClient {
  private entries = new Map<string, CacheEntry>();
  private fetch: FetchFunction;

  constructor(fetch: FetchFunction = globalThis.fetch) {
    this.fetch = fetch;
  }

  private entry(key: string): CacheEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { nextPollAt: 0 };
      this.entries.set(key, entry);
      if (this.entries.size > 4) {
        this.entries.delete(this.entries.keys().next().value!);
      }
    }
    return entry;
  }

  observe(token: string, headers: Headers): void {
    const report = parseUsageHeaders(headers);
    if (report) this.entry(tokenKey(token)).observed = report;
  }

  latest(key: string): UsageReport | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    return (entry.observed?.fetchedAt ?? 0) > (entry.report?.fetchedAt ?? 0)
      ? entry.observed
      : entry.report;
  }

  clear(): void {
    this.entries.clear();
  }

  async read(token: string, signal: AbortSignal): Promise<UsageResult> {
    signal.throwIfAborted();
    const entry = this.entry(tokenKey(token));
    if (entry.pending) return entry.pending;
    if (Date.now() < entry.nextPollAt) {
      return {
        report: entry.report ?? entry.observed,
        warning: entry.warning,
      };
    }
    entry.pending = this.poll(entry, token, signal).finally(() => {
      entry.pending = undefined;
    });
    return entry.pending;
  }

  private async poll(
    entry: CacheEntry,
    token: string,
    signal: AbortSignal,
  ): Promise<UsageResult> {
    entry.nextPollAt = Date.now() + 60_000;
    try {
      const response = await this.fetch(`${API_ORIGIN}/api/oauth/usage`, {
        headers: oauthHeaders(token),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        redirect: "error",
      });
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        const seconds = number(retryAfter);
        const retryAt =
          seconds !== undefined
            ? Date.now() + seconds * 1000
            : resetAt(retryAfter);
        if (retryAt !== undefined) {
          entry.nextPollAt = Math.max(entry.nextPollAt, retryAt);
        }
        throw new Error(`Claude usage returned HTTP ${response.status}`);
      }
      entry.report = parseUsage(await response.json());
      entry.warning = undefined;
    } catch (error) {
      if (signal.aborted) {
        entry.nextPollAt = 0;
        signal.throwIfAborted();
      }
      // Never include a response body, bearer token, or arbitrary fetch error in UI.
      entry.warning =
        error instanceof Error &&
        /^(Claude usage returned HTTP \d+|Claude (returned invalid usage data|did not report subscription or extra-usage counters))$/.test(
          error.message,
        )
          ? error.message
          : "Claude usage could not be fetched";
    }
    return { report: entry.report ?? entry.observed, warning: entry.warning };
  }
}

export function formatUsage(report: UsageReport): string {
  const lines = [
    `Anthropic OMP · ${report.source} · ${new Date(report.fetchedAt).toLocaleString()}`,
    ...report.windows.map((entry) => {
      const used =
        entry.percent === undefined
          ? "not reported"
          : `${entry.percent.toFixed(1)}% used`;
      const reset =
        entry.resetsAt === undefined
          ? ""
          : ` · resets ${new Date(entry.resetsAt).toLocaleString()}`;
      return `${entry.label}: ${used}${reset}`;
    }),
  ];
  const extra = report.extra;
  if (extra) {
    const enabled =
      extra.enabled === true
        ? "enabled"
        : extra.enabled === false
          ? "disabled"
          : "status not reported";
    const used =
      extra.used === undefined
        ? "spend not reported"
        : `$${extra.used.toFixed(2)} used`;
    const limit =
      extra.limit === undefined ? "" : ` / $${extra.limit.toFixed(2)} cap`;
    lines.push(`Extra usage: ${enabled} · ${used}${limit}`);
  } else {
    lines.push("Extra usage: not reported");
  }
  if (report.overageInUse)
    lines.push("Server reports extra usage is serving requests.");
  lines.push(
    "Account counters do not prove which pool an individual request was billed to.",
  );
  return lines.join("\n");
}
