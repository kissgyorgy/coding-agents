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
  return { emit, start, delta, end, status: () => status };
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
