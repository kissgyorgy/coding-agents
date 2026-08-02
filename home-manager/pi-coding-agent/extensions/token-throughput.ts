import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "token-throughput";

interface TokenThroughputSample {
  inputTokens: number;
  outputTokens: number;
  startedAtMs: number;
  completedAtMs: number;
}

interface ActiveTurn {
  startedAtMs: number;
  inputTokens: number;
  outputTokens: number;
  hasUsage: boolean;
  completed: boolean;
}

interface TokenThroughput {
  inputTokensPerSecond: number;
  outputTokensPerSecond: number;
}

/**
 * Calculate session-average throughput using Codex's approach: pair official
 * usage from completed turns with their wall-clock durations, then divide the
 * accumulated token counts by the union of those active intervals.
 *
 * This intentionally does not estimate live tokens from streamed text chunks.
 * Source: https://github.com/LEON-gittech/Open-Codex-CLI/commit/85e937b855
 */
function calculateTokenThroughput(
  samples: readonly TokenThroughputSample[],
): TokenThroughput | null {
  if (samples.length === 0) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  const intervals = samples
    .map((sample) => {
      inputTokens += Math.max(0, sample.inputTokens);
      outputTokens += Math.max(0, sample.outputTokens);
      return {
        startMs: sample.startedAtMs,
        endMs: sample.completedAtMs,
      };
    })
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const [firstInterval, ...remainingIntervals] = intervals;
  if (!firstInterval) return null;

  let durationMs = 0;
  let current = firstInterval;
  for (const interval of remainingIntervals) {
    if (interval.startMs <= current.endMs) {
      current.endMs = Math.max(current.endMs, interval.endMs);
      continue;
    }

    durationMs += current.endMs - current.startMs;
    current = interval;
  }
  durationMs += current.endMs - current.startMs;

  if (durationMs <= 0) return null;

  const elapsedSeconds = durationMs / 1000;
  return {
    inputTokensPerSecond: inputTokens / elapsedSeconds,
    outputTokensPerSecond: outputTokens / elapsedSeconds,
  };
}

function formatTokenThroughput(
  samples: readonly TokenThroughputSample[],
): string {
  const throughput = calculateTokenThroughput(samples);
  if (!throughput) return "in -- / out -- tok/s";

  return `in ${throughput.inputTokensPerSecond.toFixed(1)} / out ${throughput.outputTokensPerSecond.toFixed(1)} tok/s`;
}

export default function (pi: ExtensionAPI) {
  let samples: TokenThroughputSample[] = [];
  let activeTurn: ActiveTurn | null = null;

  const updateStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(
      STATUS_KEY,
      ctx.ui.theme.fg("dim", formatTokenThroughput(samples)),
    );
  };

  pi.on("session_start", async (_event, ctx) => {
    samples = [];
    activeTurn = null;
    updateStatus(ctx);
  });

  pi.on("agent_start", async () => {
    activeTurn ??= {
      startedAtMs: Date.now(),
      inputTokens: 0,
      outputTokens: 0,
      hasUsage: false,
      completed: false,
    };
  });

  pi.on("agent_end", async (event) => {
    if (!activeTurn) return;

    let lastAssistantStopReason: string | undefined;
    for (const message of event.messages) {
      if (message.role !== "assistant") continue;

      const usage = message.usage;
      // Codex's input_tokens includes cached prompt tokens. Pi reports cache
      // reads and writes separately, so combine them to recover the same total.
      const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
      activeTurn.inputTokens += Math.max(0, inputTokens);
      activeTurn.outputTokens += Math.max(0, usage.output);
      activeTurn.hasUsage ||= inputTokens > 0 || usage.output > 0;
      lastAssistantStopReason = message.stopReason;
    }

    activeTurn.completed =
      lastAssistantStopReason !== undefined &&
      lastAssistantStopReason !== "error" &&
      lastAssistantStopReason !== "aborted";
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const turn = activeTurn;
    activeTurn = null;

    if (!turn?.completed || !turn.hasUsage) return;

    const completedAtMs = Date.now();
    if (completedAtMs <= turn.startedAtMs) return;

    samples.push({
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      startedAtMs: turn.startedAtMs,
      completedAtMs,
    });
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
