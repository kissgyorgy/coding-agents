import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "token-throughput";

interface ActiveResponse {
  firstOutputAtMs: number | null;
  lastOutputAtMs: number | null;
}

/**
 * Estimate output throughput from completed responses' official token usage and
 * their first-to-last nonempty output-delta intervals. Tools, idle time, request
 * setup/TTFT, and completion bookkeeping are outside those intervals.
 *
 * This is client-observed streaming throughput, not server-side decode timing:
 * chunk buffering/network stalls and hidden reasoning can distort the estimate.
 * A single-chunk response has no measurable interval and is omitted entirely.
 */
export default function (pi: ExtensionAPI) {
  let outputTokens = 0;
  let outputDurationMs = 0;
  let activeResponse: ActiveResponse | null = null;

  const updateStatus = (ctx: ExtensionContext) => {
    const rate =
      outputDurationMs > 0
        ? ((outputTokens * 1000) / outputDurationMs).toFixed(1)
        : "--";
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `out ${rate} tok/s`));
  };

  pi.on("session_start", (_event, ctx) => {
    outputTokens = 0;
    outputDurationMs = 0;
    activeResponse = null;
    updateStatus(ctx);
  });

  pi.on("message_start", (event) => {
    if (event.message.role !== "assistant") return;
    activeResponse = { firstOutputAtMs: null, lastOutputAtMs: null };
  });

  pi.on("message_update", (event) => {
    if (!activeResponse) return;
    const delta = event.assistantMessageEvent;
    if (
      (delta.type !== "text_delta" &&
        delta.type !== "thinking_delta" &&
        delta.type !== "toolcall_delta") ||
      delta.delta.length === 0
    ) {
      return;
    }

    // A monotonic clock avoids wall-clock adjustments changing the rate.
    const now = performance.now();
    activeResponse.firstOutputAtMs ??= now;
    activeResponse.lastOutputAtMs = now;
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const response = activeResponse;
    activeResponse = null;

    const message = event.message;
    if (
      message.stopReason !== "stop" &&
      message.stopReason !== "length" &&
      message.stopReason !== "toolUse"
    ) {
      return;
    }
    if (response?.firstOutputAtMs == null || response.lastOutputAtMs == null) {
      return;
    }

    const durationMs = response.lastOutputAtMs - response.firstOutputAtMs;
    const tokens = message.usage.output;
    if (durationMs <= 0 || !Number.isFinite(tokens) || tokens <= 0) return;

    // Weight the session average by streaming duration, not by response count.
    // Successful tool-call responses count even if a later request is aborted.
    outputTokens += tokens;
    outputDurationMs += durationMs;
    updateStatus(ctx);
  });

  pi.on("agent_end", () => {
    activeResponse = null;
  });

  pi.on("session_shutdown", (_event, ctx) => {
    activeResponse = null;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
