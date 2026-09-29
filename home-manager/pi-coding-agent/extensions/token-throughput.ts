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
 * Average wait measures the pre-send request event to the first output delta,
 * not the invisible start of server-side generation. Each successful response
 * gets equal weight. Single-chunk responses count for wait, but not throughput.
 */
export default function (pi: ExtensionAPI) {
  let outputTokens = 0;
  let outputDurationMs = 0;
  let totalWaitMs = 0;
  let waitSamples = 0;
  let awaitingResponse = false;
  let requestStartedAtMs: number | null = null;
  let activeResponse: ActiveResponse | null = null;

  const resetResponse = () => {
    awaitingResponse = false;
    requestStartedAtMs = null;
    activeResponse = null;
  };

  const updateStatus = (ctx: ExtensionContext) => {
    const rate =
      outputDurationMs > 0
        ? ((outputTokens * 1000) / outputDurationMs).toFixed(1)
        : "--";
    const wait =
      waitSamples > 0 ? (totalWaitMs / waitSamples / 1000).toFixed(1) : "--";
    ctx.ui.setStatus(
      STATUS_KEY,
      ctx.ui.theme.fg("dim", `out ${rate} tok/s · wait ${wait}s avg`),
    );
  };

  pi.on("session_start", (_event, ctx) => {
    outputTokens = 0;
    outputDurationMs = 0;
    totalWaitMs = 0;
    waitSamples = 0;
    resetResponse();
    updateStatus(ctx);
  });

  pi.on("turn_start", () => {
    resetResponse();
    awaitingResponse = true;
  });

  pi.on("before_provider_request", () => {
    // message_start may arrive only after the network request has completed.
    // Ignore background requests outside this turn's pre-output phase, and
    // preserve the original timestamp if the provider retries before output.
    if (awaitingResponse) requestStartedAtMs ??= performance.now();
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
    awaitingResponse = false;
    activeResponse.firstOutputAtMs ??= now;
    activeResponse.lastOutputAtMs = now;
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const response = activeResponse;
    const startedAtMs = requestStartedAtMs;
    resetResponse();

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

    // Wait is measurable even without token usage or multiple output chunks.
    // Without a request event, omit the sample rather than underreporting wait
    // by falling back to the potentially much later message_start event.
    if (startedAtMs !== null && response.firstOutputAtMs >= startedAtMs) {
      totalWaitMs += response.firstOutputAtMs - startedAtMs;
      waitSamples += 1;
    }

    const durationMs = response.lastOutputAtMs - response.firstOutputAtMs;
    const tokens = message.usage.output;
    if (durationMs > 0 && Number.isFinite(tokens) && tokens > 0) {
      // Weight throughput by streaming duration, not by response count.
      // Successful tool-call responses count even if a later request is aborted.
      outputTokens += tokens;
      outputDurationMs += durationMs;
    }
    updateStatus(ctx);
  });

  pi.on("agent_end", resetResponse);

  pi.on("session_shutdown", (_event, ctx) => {
    resetResponse();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
