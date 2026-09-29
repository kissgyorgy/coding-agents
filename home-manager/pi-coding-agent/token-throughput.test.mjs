import assert from "node:assert/strict";
import test from "node:test";

import tokenThroughput from "./extensions/token-throughput.ts";

function createHarness(context) {
  let now = 0;
  let status;
  const originalNow = performance.now;
  performance.now = () => now;
  context.after(() => {
    performance.now = originalNow;
  });

  const handlers = new Map();
  const ctx = {
    ui: {
      theme: { fg: (_color, text) => text },
      setStatus: (key, text) => {
        assert.equal(key, "token-throughput");
        status = text;
      },
    },
  };
  tokenThroughput({ on: (name, handler) => handlers.set(name, handler) });

  const emit = (name, event = {}) => handlers.get(name)?.(event, ctx);
  const emitAt = (at, name, event = {}) => {
    now = at;
    emit(name, event);
  };
  const start = () => emit("message_start", { message: { role: "assistant" } });
  const delta = (at, type = "text_delta", text = "output") => {
    now = at;
    emit("message_update", {
      assistantMessageEvent: { type, delta: text },
    });
  };
  const end = (at, output = 100, stopReason = "stop") => {
    now = at;
    emit("message_end", {
      message: { role: "assistant", usage: { output }, stopReason },
    });
  };
  emit("session_start");
  return {
    emit,
    emitAt,
    start,
    delta,
    end,
    // Keep the original throughput regression checks independent of wait.
    status: () => status?.split(" · ")[0],
    fullStatus: () => status,
  };
}

test("excludes TTFT, completion delay, tools, and idle time", (context) => {
  const h = createHarness(context);
  assert.equal(h.status(), "out -- tok/s");
  h.emit("agent_start");
  h.start();
  h.delta(10_000);
  h.delta(12_000);
  h.end(60_000, 100, "toolUse");
  assert.equal(h.status(), "out 50.0 tok/s");

  h.emit("tool_execution_start");
  h.emit("message_start", { message: { role: "toolResult" } });
  h.emit("message_end", { message: { role: "toolResult" } });
  h.emit("tool_execution_end");
  h.start();
  h.delta(1_000_000);
  h.delta(1_002_000);
  h.end(2_000_000, 100);
  h.emit("agent_end");
  h.emit("agent_settled");
  assert.equal(h.status(), "out 50.0 tok/s");

  h.emit("agent_start");
  h.start();
  h.delta(3_000_000);
  h.delta(3_002_000);
  h.end(4_000_000, 100);
  assert.equal(h.status(), "out 50.0 tok/s");
});

test("uses duration-weighted rates across thinking, text, and tool output", (context) => {
  const h = createHarness(context);
  h.start();
  h.delta(100, "thinking_delta");
  h.delta(1_100, "text_delta");
  h.delta(2_100, "toolcall_delta");
  h.end(10_000, 100, "toolUse");
  h.start();
  h.delta(20_000);
  h.delta(21_000);
  h.end(30_000, 100, "length");
  assert.equal(h.status(), "out 66.7 tok/s");
});

test("ignores empty deltas and non-output events at stream boundaries", (context) => {
  const h = createHarness(context);
  h.start();
  h.delta(10, "text_start");
  h.delta(100, "text_delta", "");
  h.delta(1_000);
  h.delta(2_000);
  h.delta(10_000, "thinking_delta", "");
  h.delta(20_000, "text_end");
  h.end(30_000, 100);
  assert.equal(h.status(), "out 100.0 tok/s");
});

test("omits single-chunk, unstreamed, and zero-duration responses entirely", (context) => {
  const h = createHarness(context);
  h.start();
  h.end(10_000, 1_000);
  h.start();
  h.delta(20_000);
  h.end(30_000, 1_000);
  h.start();
  h.delta(40_000);
  h.delta(40_000);
  h.end(50_000, 1_000);
  assert.equal(h.status(), "out -- tok/s");

  h.start();
  h.delta(60_000);
  h.delta(61_000);
  h.end(70_000, 100);
  assert.equal(h.status(), "out 100.0 tok/s");
});

test("discards failed requests without losing earlier successful output", (context) => {
  const h = createHarness(context);
  h.start();
  h.delta(1_000);
  h.delta(2_000);
  h.end(3_000, 100, "toolUse");
  for (const reason of ["error", "aborted", "pending", "deferred"]) {
    h.start();
    h.delta(10_000);
    h.delta(20_000);
    h.end(30_000, 1_000, reason);
    h.emit("agent_end");
    h.emit("agent_settled");
    assert.equal(h.status(), "out 100.0 tok/s");
  }
  h.start();
  h.delta(40_000);
  h.delta(41_000);
  h.end(50_000, 50);
  assert.equal(h.status(), "out 75.0 tok/s");
});

test("omits missing, nonfinite, and nonpositive usage without diluting the rate", (context) => {
  const h = createHarness(context);
  for (const tokens of [0, -1, NaN, Infinity, null]) {
    h.start();
    h.delta(1_000);
    h.delta(2_000);
    h.end(3_000, tokens);
  }
  assert.equal(h.status(), "out -- tok/s");
  h.start();
  h.delta(4_000);
  h.delta(5_000);
  h.end(6_000, 100);
  // Duplicate message_end must not count the same usage twice.
  h.end(7_000, 1_000);
  assert.equal(h.status(), "out 100.0 tok/s");
});

test("resets samples and incomplete streams on session changes", (context) => {
  const h = createHarness(context);
  h.start();
  h.delta(1_000);
  h.delta(2_000);
  h.end(3_000, 100);
  h.start();
  h.delta(4_000);
  h.emit("session_start");
  h.delta(5_000);
  h.end(6_000, 1_000);
  assert.equal(h.status(), "out -- tok/s");
  h.start();
  h.delta(7_000);
  h.delta(8_000);
  h.end(9_000, 50);
  assert.equal(h.status(), "out 50.0 tok/s");
  h.emit("session_shutdown");
  assert.equal(h.status(), undefined);
});

test("averages request-to-first-output wait independently of throughput", (context) => {
  const h = createHarness(context);
  assert.equal(h.fullStatus(), "out -- tok/s · wait --s avg");
  h.emitAt(0, "turn_start");
  // Local request preparation before the payload is ready is not wait.
  h.emitAt(1_000, "before_provider_request");
  h.emitAt(9_000, "message_start", { message: { role: "assistant" } });
  h.delta(11_000);
  h.delta(13_000);
  h.end(60_000, 100, "toolUse");
  assert.equal(h.fullStatus(), "out 50.0 tok/s · wait 10.0s avg");

  h.emitAt(70_000, "tool_execution_start");
  h.emitAt(80_000, "before_provider_request"); // Nested/background request.
  h.emitAt(900_000, "tool_execution_end");
  h.emitAt(1_000_000, "turn_start");
  h.emitAt(1_001_000, "before_provider_request");
  h.start();
  h.delta(1_003_000, "thinking_delta");
  h.delta(1_004_000, "toolcall_delta");
  h.end(2_000_000, 100);
  // Wait is (10 + 2) / 2, not weighted by duration or output tokens.
  assert.equal(h.fullStatus(), "out 66.7 tok/s · wait 6.0s avg");
});

test("wait stops at the first nonempty delta, including tool-call output", (context) => {
  const h = createHarness(context);
  h.emitAt(0, "turn_start");
  // Some providers emit message_start before invoking the request callback.
  h.start();
  h.emitAt(1_000, "before_provider_request");
  h.delta(2_000, "toolcall_start");
  h.delta(3_000, "toolcall_delta", "");
  h.delta(4_000, "toolcall_delta");
  h.delta(5_000, "text_delta");
  h.end(90_000, 100, "toolUse");
  assert.equal(h.fullStatus(), "out 100.0 tok/s · wait 3.0s avg");
});

test("single-chunk and usage-free responses still contribute wait, including zero wait", (context) => {
  const h = createHarness(context);
  h.emitAt(0, "turn_start");
  h.emitAt(0, "before_provider_request");
  h.start();
  h.delta(0);
  h.end(10_000, 0);
  assert.equal(h.fullStatus(), "out -- tok/s · wait 0.0s avg");

  h.emitAt(20_000, "turn_start");
  h.emitAt(21_000, "before_provider_request");
  h.start();
  h.delta(23_000);
  h.end(30_000, 100);
  assert.equal(h.fullStatus(), "out -- tok/s · wait 1.0s avg");
});

test("failed and output-free responses do not become wait samples", (context) => {
  const h = createHarness(context);
  for (const reason of ["error", "aborted", "pending", "deferred"]) {
    h.emitAt(0, "turn_start");
    h.emitAt(1_000, "before_provider_request");
    h.start();
    h.delta(20_000);
    h.end(30_000, 100, reason);
    h.emit("agent_end");
  }
  h.emitAt(40_000, "turn_start");
  h.emitAt(41_000, "before_provider_request");
  h.start();
  h.end(50_000, 100);
  assert.equal(h.fullStatus(), "out -- tok/s · wait --s avg");

  h.emitAt(60_000, "turn_start");
  h.emitAt(61_000, "before_provider_request");
  h.start();
  h.delta(62_000);
  h.end(63_000, 100);
  h.end(64_000, 100); // No duplicate wait sample.
  assert.equal(h.fullStatus(), "out -- tok/s · wait 1.0s avg");
});

test("keeps the initial request timestamp across retries and ignores background events", (context) => {
  const h = createHarness(context);
  h.emitAt(0, "before_provider_request"); // Idle cache warm.
  h.emitAt(60_000, "turn_start");
  h.emitAt(61_000, "before_provider_request");
  h.emitAt(65_000, "before_provider_request"); // Provider-level retry.
  h.start();
  h.delta(71_000);
  h.emitAt(72_000, "before_provider_request"); // Background request mid-stream.
  h.delta(73_000);
  h.end(80_000, 100);
  assert.equal(h.fullStatus(), "out 50.0 tok/s · wait 10.0s avg");
});

test("clears pending request timing on abort and resets averages on session changes", (context) => {
  const h = createHarness(context);
  h.emitAt(0, "turn_start");
  h.emitAt(1_000, "before_provider_request");
  h.start();
  h.emitAt(20_000, "agent_end");
  h.emitAt(30_000, "before_provider_request"); // Idle background request.
  h.start(); // No request event for this response; do not invent a wait.
  h.delta(40_000);
  h.delta(41_000);
  h.end(50_000, 100);
  assert.equal(h.fullStatus(), "out 100.0 tok/s · wait --s avg");

  h.emitAt(60_000, "turn_start");
  h.emitAt(61_000, "before_provider_request");
  h.start();
  h.delta(62_000);
  h.end(63_000, 100);
  assert.equal(h.fullStatus(), "out 100.0 tok/s · wait 1.0s avg");
  h.emitAt(70_000, "turn_start");
  h.emitAt(71_000, "before_provider_request");
  h.start();
  h.emitAt(72_000, "session_start");
  h.delta(73_000);
  h.end(74_000, 100);
  assert.equal(h.fullStatus(), "out -- tok/s · wait --s avg");
  h.emit("session_shutdown");
  assert.equal(h.fullStatus(), undefined);
});
