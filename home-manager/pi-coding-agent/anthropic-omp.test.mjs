// Run with: node --experimental-vm-modules --test home-manager/pi-coding-agent/anthropic-omp.test.mjs
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const extensionUrl = new URL("./extensions/anthropic-omp/", import.meta.url);
const plain = (value) => JSON.parse(JSON.stringify(value));
const token = "sk-ant-oat-test-secret";
const credential = {
  type: "oauth",
  access: token,
  refresh: "refresh-secret",
  expires: Date.now() + 3_600_000,
  ompInstallId: "install-1",
  accountId: "account-1",
  orgId: "org-1",
};
const identity = {
  sessionId: "session-1",
  deviceId: "device-1",
  accountId: "account-1",
};
const model = {
  id: "claude-sonnet-4-6",
  name: "Claude Sonnet 4.6",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 200000,
  maxTokens: 64000,
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  compat: { forceAdaptiveThinking: true },
};

async function harness({ env = {}, api: suppliedApi } = {}) {
  const providers = [];
  const commands = new Map();
  const handlers = new Map();
  const requests = [];
  const calls = [];
  const authCalls = [];
  const notifications = [];
  const statuses = [];
  let fetchImpl = async () => {
    throw new Error("Unexpected network request");
  };
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return fetchImpl(request);
  };
  const oauth = {
    name: "Anthropic (Claude Pro/Max)",
    isSubscription: true,
    login: async (...args) => {
      authCalls.push(["login", ...args]);
      return { ...credential };
    },
    refresh: async (...args) => {
      authCalls.push(["refresh", ...args]);
      return {
        type: "oauth",
        access: "sk-ant-oat-refreshed",
        refresh: "new-refresh",
        expires: Date.now() + 3_600_000,
      };
    },
    toAuth: async (value) => ({ apiKey: value.access }),
  };
  const upstream = {
    id: "anthropic",
    name: "Anthropic",
    auth: { oauth, apiKey: { name: "Do not copy API-key auth" } },
    getModels: () => [model],
  };
  const api = suppliedApi ?? {
    stream: (...args) => calls.push(["stream", ...args]),
    streamSimple: (...args) => calls.push(["streamSimple", ...args]),
  };
  const context = createContext({
    process: { env },
    Buffer,
    TextEncoder,
    TextDecoder,
    Headers,
    Request,
    Response,
    ReadableStream,
    TransformStream,
    AbortSignal,
    AbortController,
    URL,
    fetch,
  });
  const modules = new Map();
  function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const module = new SourceTextModule(
      stripTypeScriptTypes(readFileSync(url, "utf8")),
      { context, identifier: url.href },
    );
    modules.set(url.href, module);
    return module;
  }
  const main = load(new URL("index.ts", extensionUrl));
  await main.link((specifier, referencing) => {
    if (specifier.startsWith(".")) {
      return load(new URL(specifier, referencing.identifier));
    }
    let exports;
    if (specifier === "node:crypto") exports = crypto;
    else if (specifier === "@earendil-works/pi-ai/compat") {
      exports = {
        anthropicMessagesApi: () => api,
        hasApi: (model, id) => model.api === id,
      };
    } else if (specifier === "@earendil-works/pi-ai/providers/all") {
      exports = { builtinProviders: () => [upstream] };
    } else throw new Error(`Unexpected import ${specifier}`);
    return new SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) {
          this.setExport(name, value);
        }
      },
      { context },
    );
  });
  await main.evaluate();
  const pi = {
    registerProvider: (value) => providers.push(value),
    registerCommand: (name, value) => commands.set(name, value),
    on: (name, handler) => handlers.set(name, handler),
  };
  main.namespace.default(pi);
  const provider = providers[0];
  const ctx = {
    model: provider.getModels()[0],
    hasUI: true,
    sessionManager: { getSessionId: () => "pi-session" },
    ui: {
      notify: (...args) => notifications.push(args),
      setStatus: (...args) => statuses.push(args),
    },
    modelRegistry: {
      getProviderAuth: async (id) => {
        assert.equal(id, "anthropic-omp");
        return { auth: await provider.auth.oauth.toAuth(credential) };
      },
    },
  };
  return {
    provider,
    providers,
    upstream,
    oauth,
    commands,
    handlers,
    requests,
    calls,
    authCalls,
    notifications,
    statuses,
    ctx,
    setFetch: (value) => (fetchImpl = value),
    fetch,
    transport: modules.get(new URL("transport.ts", extensionUrl).href)
      .namespace,
    usage: modules.get(new URL("usage.ts", extensionUrl).href).namespace,
    hash: modules.get(new URL("xxhash.ts", extensionUrl).href).namespace,
  };
}

function payload() {
  return {
    model: model.id,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Hello from Unicode 🌍 — cch=00000" }],
      },
    ],
    system: [
      {
        type: "text",
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: "Keep the user's cch=00000 unchanged" },
    ],
    tools: [{ name: "Bash", input_schema: { type: "object" } }],
    max_tokens: 1024,
    stream: true,
  };
}

function sseResponse(events, { chunkSize = 7, newline = "\n", headers } = {}) {
  const bytes = new TextEncoder().encode(
    events
      .map(
        (event) =>
          `event: ${event.type}${newline}data: ${JSON.stringify(event)}${newline}${newline}`,
      )
      .join(""),
  );
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      },
    }),
    { headers: { "content-type": "text/event-stream", ...headers } },
  );
}

function toolEvents(name = "_Bash") {
  return [
    {
      type: "message_start",
      message: {
        id: "msg-test",
        type: "message",
        role: "assistant",
        model: model.id,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tool-1", name, input: {} },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: '{"command":"echo 🌍"}',
      },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 7 },
    },
    { type: "message_stop" },
  ];
}

const endpointUsage = {
  five_hour: { utilization: 27, resets_at: "2026-11-01T06:00:00Z" },
  seven_day: { utilization: 42, resets_at: "2026-11-07T06:00:00Z" },
  spend: {
    enabled: true,
    used: { amount_minor: 125, exponent: 2, currency: "USD" },
    limit: { amount_minor: 1000, exponent: 2, currency: "USD" },
  },
};

test("registers a separate OAuth-only provider and preserves the original catalog", async () => {
  const h = await harness();
  assert.equal(h.providers.length, 1);
  assert.equal(h.provider.id, "anthropic-omp");
  assert.equal(h.upstream.id, "anthropic");
  assert.equal(h.provider.auth.apiKey, undefined);
  assert.equal(h.provider.auth.oauth.isSubscription, true);
  const [entry] = h.provider.getModels();
  assert.equal(entry.provider, "anthropic-omp");
  assert.equal(entry.api, "anthropic-messages");
  assert.deepEqual(plain(entry.compat), model.compat);
  assert.equal(entry.contextWindow, model.contextWindow);
  assert.equal(model.provider, "anthropic");
  assert.equal(h.requests.length, 0);
});

test("delegates OAuth login, enriches identity and preserves it on token refresh", async () => {
  const h = await harness();
  h.setFetch(async (request) => {
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
    assert.equal(request.redirect, "error");
    return Response.json({
      oauth_account: {
        account_uuid: "real-account",
        account_email: "user@example.test",
        organization_uuid: "real-org",
      },
    });
  });
  const interaction = {
    signal: new AbortController().signal,
    notify: (...args) => h.notifications.push(args),
  };
  const options = { getDeviceId: () => "stable-install" };
  const saved = await h.provider.auth.oauth.login(interaction, options);
  assert.equal(saved.access, token);
  assert.equal(saved.ompInstallId, "stable-install");
  assert.equal(saved.accountId, "real-account");
  assert.equal(saved.orgId, "real-org");
  assert.equal(h.authCalls[0][1], interaction);
  assert.equal(h.authCalls[0][2], options);
  assert.match(h.notifications[0][0].message, /does not guarantee/);
  const refreshed = await h.provider.auth.oauth.refresh(
    saved,
    new AbortController().signal,
  );
  assert.equal(refreshed.access, "sk-ant-oat-refreshed");
  assert.equal(refreshed.refresh, "new-refresh");
  assert.equal(refreshed.accountId, "real-account");
  assert.equal(refreshed.orgId, "real-org");
  assert.equal(refreshed.ompInstallId, "stable-install");
  assert.equal(
    (await h.provider.auth.oauth.toAuth(refreshed)).apiKey,
    refreshed.access,
  );
});

test("a failed bootstrap does not discard login tokens or log sensitive errors", async () => {
  const h = await harness();
  h.setFetch(async () => {
    throw new Error(`network failure with ${token}`);
  });
  const saved = await h.provider.auth.oauth.login({
    signal: new AbortController().signal,
    notify: () => {},
  });
  assert.equal(saved.access, token);
  assert.equal(typeof saved.ompInstallId, "string");
  h.oauth.refresh = async () => {
    throw new Error(`response contained ${token}`);
  };
  await assert.rejects(
    h.provider.auth.oauth.refresh(saved, new AbortController().signal),
    (error) =>
      /refresh failed/.test(error.message) && !error.message.includes(token),
  );
});

test("XXH64 matches OMP Bun oracle values across short tails and full blocks", async () => {
  const h = await harness();
  const fixtures = [
    [0, "b8b30e7de65b46c5"],
    [1, "f0568d7109c90bae"],
    [4, "4852146ddb911406"],
    [7, "72445fe100d99b0c"],
    [8, "a3d170b8020c953e"],
    [15, "16d7be83bccb0b1b"],
    [16, "425cf4a8beb9f655"],
    [31, "3dc331e172a622bb"],
    [32, "d37ae0882f52d673"],
    [33, "dda11ce73c6aa418"],
    [63, "22991673c4ee3189"],
    [64, "30ebf736d8c9f0c5"],
    [65, "cb2f53dd3f4ff79c"],
    [255, "4baddc8cf92786b2"],
    [1024, "72df6e85981c2a70"],
  ];
  for (const [length, expected] of fixtures) {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 251);
    assert.equal(
      h.hash.xxhash64(bytes, 0x4d659218e32a3268n).toString(16),
      expected,
      `length ${length}`,
    );
    const padded = new Uint8Array(length + 11);
    padded.set(bytes, 7);
    assert.equal(
      h.hash
        .xxhash64(padded.subarray(7, 7 + length), 0x4d659218e32a3268n)
        .toString(16),
      expected,
    );
  }
});

test("attests final UTF-8 bytes without changing lookalikes in user content", async () => {
  const h = await harness();
  const original = payload();
  const bytes = h.transport.adaptPayload(original, identity, "2.1.280");
  const text = new TextDecoder().decode(bytes);
  const body = JSON.parse(text);
  const billing = body.system[0].text;
  assert.match(
    billing,
    /^x-anthropic-billing-header: cc_version=2\.1\.280\.[0-9a-f]{3}; cc_entrypoint=cli; cch=[0-9a-f]{5};$/,
  );
  const cch = billing.match(/cch=([0-9a-f]{5})/)[1];
  const zeroed = text.replace(
    billing,
    billing.replace(`cch=${cch}`, "cch=00000"),
  );
  assert.equal(
    (
      h.hash.xxhash64(new TextEncoder().encode(zeroed), 0x4d659218e32a3268n) &
      0xfffffn
    )
      .toString(16)
      .padStart(5, "0"),
    cch,
  );
  assert.equal(body.system[2].text, "Keep the user's cch=00000 unchanged");
  assert.match(body.messages[0].content[0].text, /🌍 — cch=00000$/);
  assert.equal(body.system.length, 3);
  assert.deepEqual(body.system[1].cache_control, { type: "ephemeral" });
  assert.deepEqual(JSON.parse(body.metadata.user_id), {
    device_id: "device-1",
    session_id: "session-1",
    account_uuid: "account-1",
  });
  const changed = payload();
  changed.max_tokens = 2048;
  const next = JSON.parse(
    new TextDecoder().decode(h.transport.adaptPayload(changed, identity)),
  );
  assert.notEqual(next.system[0].text.match(/cch=(\w+)/)[1], cch);
});

test("prefixes tool definitions, history, references and choices but not schemas or inputs", async () => {
  const h = await harness();
  const body = payload();
  body.tools.push(
    { type: "web_search_20250305", name: "web_search" },
    { name: "_private", input_schema: { name: "Bash" } },
  );
  body.tool_choice = { type: "tool", name: "Bash" };
  body.messages.push({
    role: "assistant",
    content: [{ type: "tool_use", name: "Bash", input: { name: "Bash" } }],
  });
  body.messages.push({
    role: "system",
    content: [
      {
        type: "tool_addition",
        tool: { type: "tool_definition", definition: { name: "Edit" } },
      },
      { type: "tool_removal", tool: { type: "tool_reference", name: "Read" } },
    ],
  });
  const result = JSON.parse(
    new TextDecoder().decode(h.transport.adaptPayload(body, identity)),
  );
  assert.equal(result.tools[0].name, "_Bash");
  assert.equal(result.tools[1].name, "web_search");
  assert.equal(result.tools[2].name, "__private");
  assert.equal(result.tools[2].input_schema.name, "Bash");
  assert.equal(result.tool_choice.name, "_Bash");
  assert.equal(result.messages[1].content[0].name, "_Bash");
  assert.equal(result.messages[1].content[0].input.name, "Bash");
  assert.equal(result.messages[2].content[0].tool.definition.name, "_Edit");
  assert.equal(result.messages[2].content[1].tool.name, "_Read");
});

test("uses account-scoped stable device IDs and configurable CLI versions", async () => {
  const h = await harness({ env: { PI_AI_CLAUDE_CODE_VERSION: "2.1.999" } });
  const id = h.transport.deviceId("install", "account");
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(h.transport.deviceId("install", "account"), id);
  assert.notEqual(h.transport.deviceId("install", "another"), id);
  assert.equal(h.transport.claudeVersion(), "2.1.999");
  const invalid = await harness({
    env: { PI_AI_CLAUDE_CODE_VERSION: "bad\r\nheader" },
  });
  assert.throws(() => invalid.transport.claudeVersion(), /semantic version/);
});

test("pins credentials and request identity to the official endpoint, preserving cancellation", async () => {
  const h = await harness();
  h.setFetch(async () => Response.json({ ok: true }));
  const seen = [];
  const fetch = h.transport.ompFetch(h.fetch, token, identity, (headers) =>
    seen.push(headers),
  );
  const signal = new AbortController().signal;
  await fetch("https://api.anthropic.com/v1/messages?beta=true", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "X-Api-Key": "wrong",
      Authorization: "Bearer wrong",
      "anthropic-beta": "custom-beta,context-1m-2025-08-07,custom-beta",
      "x-custom-trace": "keep",
    },
    body: JSON.stringify(payload()),
  });
  const request = h.requests[0];
  assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  assert.equal(request.headers.get("x-api-key"), null);
  assert.equal(request.headers.get("x-custom-trace"), "keep");
  assert.equal(request.headers.get("x-claude-code-session-id"), "session-1");
  assert.equal(
    request.headers.get("user-agent"),
    "claude-cli/2.1.280 (external, cli)",
  );
  assert.equal(request.headers.get("x-stainless-package-version"), "0.112.1");
  assert.equal(request.redirect, "error");
  assert.equal(request.signal.aborted, false);
  const betas = request.headers.get("anthropic-beta").split(",");
  assert.ok(betas.includes("oauth-2025-04-20"));
  assert.ok(betas.includes("custom-beta"));
  assert.ok(!betas.includes("context-1m-2025-08-07"));
  assert.equal(betas.length, new Set(betas).size);
  assert.equal(seen.length, 1);
  for (const url of [
    "http://api.anthropic.com/v1/messages",
    "https://other.test/v1/messages",
    "https://api.anthropic.com/other",
  ]) {
    await assert.rejects(
      fetch(url, { method: "POST", body: "{}" }),
      /only sends credentials/,
    );
  }
  await assert.rejects(
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify(payload()),
      signal: AbortSignal.abort(),
    }),
    { name: "AbortError" },
  );
  assert.equal(h.requests.length, 1);
});

test("restores streamed tool names across UTF-8 chunks, LF and CRLF", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const h = await harness();
    h.setFetch(async () =>
      sseResponse(toolEvents("__private"), { chunkSize: 1, newline }),
    );
    const fetch = h.transport.ompFetch(h.fetch, token, identity, () => {});
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify(payload()),
    });
    const text = await response.text();
    assert.match(text, /"name":"_private"/);
    assert.ok(!text.includes('"name":"__private"'));
    assert.match(text, /🌍/);
    assert.match(text, /event: message_stop/);
  }
});

test("passes HTTP errors through without interpreting them as successful streams", async () => {
  const h = await harness();
  h.setFetch(
    async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "60" },
      }),
  );
  const fetch = h.transport.ompFetch(h.fetch, token, identity, () => {});
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 429);
  assert.equal(await response.text(), "rate limited");
  assert.equal(response.headers.get("retry-after"), "60");
});

test("delegates both stream paths and request hooks using isolated login identity", async () => {
  const h = await harness();
  await h.provider.auth.oauth.toAuth(credential);
  const onPayload = () => {};
  const options = {
    apiKey: token,
    sessionId: "nested-session",
    onPayload,
    metadata: { test: true },
    fetch: h.fetch,
  };
  for (const method of ["stream", "streamSimple"]) {
    h.provider[method](h.provider.getModels()[0], { messages: [] }, options);
  }
  assert.equal(h.calls.length, 2);
  for (const [, , , adapted] of h.calls) {
    assert.equal(adapted.onPayload, onPayload);
    assert.equal(adapted.metadata, options.metadata);
    assert.equal(adapted.sessionId, "nested-session");
    assert.notEqual(adapted.fetch, h.fetch);
  }
  assert.throws(
    () => h.provider.streamSimple(model, {}, { apiKey: "api-key" }),
    /login anthropic-omp/,
  );
  assert.throws(
    () => h.provider.stream(model, {}, { apiKey: token, client: {} }),
    /injected SDK clients/,
  );
});

test("parses generic and legacy limits, including inactive model-scoped weekly rows", async () => {
  const h = await harness();
  const report = h.usage.parseUsage(
    {
      ...endpointUsage,
      limits: [
        {
          kind: "weekly_scoped",
          percent: 12,
          is_active: false,
          resets_at: "2026-11-07T00:00:00Z",
          scope: { model: { display_name: "Opus" } },
        },
      ],
      seven_day_sonnet: { utilization: 5 },
    },
    123,
  );
  assert.deepEqual(
    plain(report.windows.map(({ id, percent }) => ({ id, percent }))),
    [
      { id: "5h", percent: 27 },
      { id: "7d", percent: 42 },
      { id: "7d:opus", percent: 12 },
      { id: "7d:sonnet", percent: 5 },
    ],
  );
  assert.deepEqual(plain(report.extra), {
    enabled: true,
    used: 1.25,
    limit: 10,
  });
  assert.equal(report.fetchedAt, 123);
  const generic = h.usage.parseUsage({
    five_hour: {},
    seven_day: { utilization: null },
    limits: [
      { kind: "session", percent: 2 },
      { kind: "weekly_all", percent: 3 },
    ],
  });
  assert.deepEqual(
    plain(generic.windows.map((entry) => entry.percent)),
    [2, 3],
  );
  assert.throws(() => h.usage.parseUsage({}), /did not report/);
  assert.throws(() => h.usage.parseUsage(null), /invalid usage data/);
});

test("does not invent missing counters, caps, or USD spending", async () => {
  const h = await harness();
  const legacy = h.usage.parseUsage({
    extra_usage: { is_enabled: true, used_credits: 425, monthly_limit: null },
  });
  assert.equal(legacy.extra.used, 4.25);
  assert.equal(legacy.extra.limit, undefined);
  assert.match(h.usage.formatUsage(legacy), /\$4\.25 used/);
  const disabled = h.usage.parseUsage({
    ...endpointUsage,
    spend: { enabled: false },
    extra_usage: { is_enabled: true, used_credits: 9999 },
  });
  assert.equal(disabled.extra.enabled, false);
  assert.equal(disabled.extra.used, undefined);
  const otherCurrency = h.usage.parseUsage({
    spend: {
      enabled: true,
      used: { amount_minor: 50, exponent: 2, currency: "EUR" },
    },
  });
  assert.equal(otherCurrency.extra.used, undefined);
  assert.match(h.usage.formatUsage(otherCurrency), /spend not reported/);
  const headers = h.usage.parseUsageHeaders(
    new Headers({
      "anthropic-ratelimit-unified-5h-utilization": "0.275",
      "anthropic-ratelimit-unified-7d-utilization": "bad",
      "anthropic-ratelimit-unified-overage-in-use": "true",
    }),
  );
  assert.equal(headers.windows.length, 1);
  assert.equal(headers.windows[0].percent, 27.500000000000004);
  assert.equal(headers.overageInUse, true);
  assert.equal(h.usage.parseUsageHeaders(new Headers()), undefined);
});

test("caches usage, isolates accounts and does not retry a rate-limited endpoint", async () => {
  const h = await harness();
  h.setFetch(async () => Response.json(endpointUsage));
  const client = new h.usage.UsageClient(h.fetch);
  const signal = new AbortController().signal;
  const [first, second] = await Promise.all([
    client.read(token, signal),
    client.read(token, signal),
  ]);
  assert.equal(first.report, second.report);
  await client.read(token, signal);
  assert.equal(h.requests.length, 1);
  await client.read("sk-ant-oat-other-account", signal);
  assert.equal(h.requests.length, 2);
  h.setFetch(
    async () =>
      new Response("private error body", {
        status: 429,
        headers: { "retry-after": "120" },
      }),
  );
  const limited = await client.read("sk-ant-oat-limited", signal);
  assert.match(limited.warning, /HTTP 429/);
  assert.equal(limited.report, undefined);
  assert.ok(
    client.entries.get(h.transport.tokenKey("sk-ant-oat-limited")).nextPollAt >=
      Date.now() + 119_000,
  );
  await client.read("sk-ant-oat-limited", signal);
  assert.equal(h.requests.length, 3);
  const request = h.requests[0];
  assert.equal(request.url, "https://api.anthropic.com/api/oauth/usage");
  assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  assert.equal(request.redirect, "error");
  await assert.rejects(client.read(token, AbortSignal.abort()), {
    name: "AbortError",
  });
});

test("usage failures retain the previous report and timestamp without exposing errors", async () => {
  const h = await harness();
  h.setFetch(async () => Response.json(endpointUsage));
  const client = new h.usage.UsageClient(h.fetch);
  const signal = new AbortController().signal;
  const first = await client.read(token, signal);
  // Private fields are ordinary JS fields after type erasure; advance only this cache's deadline.
  client.entries.get(h.transport.tokenKey(token)).nextPollAt = 0;
  h.setFetch(async () => {
    throw new Error(`error with ${token}`);
  });
  const failed = await client.read(token, signal);
  assert.equal(failed.report.fetchedAt, first.report.fetchedAt);
  assert.equal(failed.report, first.report);
  assert.equal(failed.warning, "Claude usage could not be fetched");
  assert.ok(!JSON.stringify(failed).includes(token));
});

test("usage command and status are provider-scoped, with overage warnings and cleanup", async () => {
  const h = await harness();
  h.handlers.get("session_start")({}, h.ctx);
  assert.match(h.notifications[0][0], /experimental/);
  await h.provider.auth.oauth.toAuth(credential);
  h.setFetch(async () => Response.json(endpointUsage));
  await h.commands.get("anthropic-usage").handler("", h.ctx);
  assert.ok(
    h.notifications.some(
      ([text]) => typeof text === "string" && text.includes("$1.25 used"),
    ),
  );
  assert.match(h.statuses.at(-1)[1], /5h 27%.*7d 42%/);
  h.setFetch(async () =>
    Response.json(
      {},
      {
        headers: {
          "anthropic-ratelimit-unified-5h-utilization": "0.5",
          "anthropic-ratelimit-unified-overage-in-use": "true",
        },
      },
    ),
  );
  h.provider.streamSimple(
    h.provider.getModels()[0],
    { messages: [] },
    { apiKey: token, fetch: h.fetch },
  );
  const fetch = h.calls.at(-1)[3].fetch;
  await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    body: JSON.stringify(payload()),
  });
  h.handlers.get("after_provider_response")({}, h.ctx);
  assert.match(h.statuses.at(-1)[1], /5h 50%/);
  assert.ok(
    h.notifications.some(([text]) => text.includes("paid extra usage")),
  );
  const otherCtx = { ...h.ctx, model: { provider: "anthropic" } };
  h.handlers.get("model_select")({}, otherCtx);
  assert.equal(h.statuses.at(-1)[1], undefined);
  h.handlers.get("session_shutdown")({}, h.ctx);
  assert.equal(h.statuses.at(-1)[1], undefined);
  assert.throws(
    () => h.provider.streamSimple(model, {}, { apiKey: token }),
    /login anthropic-omp/,
  );
});

test("usage commands cannot update a replacement session after awaiting authentication", async () => {
  const h = await harness();
  let resolveAuth;
  h.ctx.modelRegistry.getProviderAuth = () =>
    new Promise((resolve) => {
      resolveAuth = resolve;
    });
  const running = h.commands.get("anthropic-usage").handler("", h.ctx);
  h.handlers.get("session_shutdown")({}, h.ctx);
  h.handlers.get("session_start")({}, h.ctx);
  const previousNotifications = h.notifications.length;
  resolveAuth({ auth: { apiKey: token } });
  await running;
  assert.equal(h.requests.length, 0);
  assert.equal(h.notifications.length, previousNotifications);
});

test("cancelling a transformed SSE body cancels the original response stream", async () => {
  const h = await harness();
  let cancelled = false;
  h.setFetch(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const fetch = h.transport.ompFetch(h.fetch, token, identity, () => {});
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    body: JSON.stringify(payload()),
  });
  await response.body.cancel();
  assert.equal(cancelled, true);
});

const piPackage = process.env.PI_PACKAGE_DIR;

test(
  "loads with Pi's real extension loader",
  { skip: !piPackage },
  async () => {
    const { loadExtensions } = await import(
      pathToFileURL(`${piPackage}/dist/core/extensions/loader.js`).href
    );
    const loaded = await loadExtensions(
      [fileURLToPath(new URL("index.ts", extensionUrl))],
      process.cwd(),
    );
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.equal(
      loaded.runtime.pendingNativeProviderRegistrations[0].provider.id,
      "anthropic-omp",
    );
  },
);

test(
  "Pi stores and refreshes only this provider's credentials",
  { skip: !piPackage },
  async () => {
    const { createModels, InMemoryCredentialStore } = await import(
      new URL("../pi-ai/dist/index.js", pathToFileURL(`${piPackage}/`)).href
    );
    const h = await harness();
    h.setFetch(async () =>
      Response.json({ oauth_account: { account_uuid: "new-account" } }),
    );
    const store = new InMemoryCredentialStore();
    await store.modify("anthropic", async () => credential);
    const models = createModels({ credentials: store });
    models.setProvider(h.provider);
    await models.login(
      "anthropic-omp",
      "oauth",
      { notify: () => {}, prompt: async () => "" },
      { getDeviceId: () => "pi-install" },
    );
    assert.equal((await store.read("anthropic-omp")).accountId, "new-account");
    assert.equal((await store.read("anthropic")).access, token);
    await store.modify("anthropic-omp", async (saved) => ({
      ...saved,
      expires: 0,
    }));
    assert.equal(
      (await models.getAuth("anthropic-omp")).auth.apiKey,
      "sk-ant-oat-refreshed",
    );
    assert.equal((await store.read("anthropic-omp")).accountId, "new-account");
    await models.logout("anthropic-omp");
    assert.equal(await store.read("anthropic-omp"), undefined);
    assert.equal((await store.read("anthropic")).access, token);
    assert.equal(await models.getAuth("anthropic-omp"), undefined);
  },
);

test(
  "real Pi streaming round-trips tools, preserves hooks and attributes usage to the new provider",
  { skip: !piPackage },
  async () => {
    const ai = await import(
      new URL("../pi-ai/dist/compat.js", pathToFileURL(`${piPackage}/`)).href
    );
    const h = await harness({ api: ai.anthropicMessagesApi() });
    await h.provider.auth.oauth.toAuth(credential);
    const seen = [];
    const responseHeaders = [];
    h.setFetch(async () => sseResponse(toolEvents(), { chunkSize: 3 }));
    const context = ai.normalizeContext({
      systemPrompt: "Use tools carefully",
      tools: [
        {
          name: "bash",
          description: "Run a command",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: "Please check this directory",
          timestamp: Date.now(),
        },
      ],
    });
    const stream = h.provider.streamSimple(h.provider.getModels()[0], context, {
      apiKey: token,
      fetch: h.fetch,
      onPayload: (body) => ({ ...body, max_tokens: 1234 }),
      onResponse: (response) => responseHeaders.push(response.status),
      onProviderStreamEvent: (event) => seen.push(event),
    });
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();
    assert.equal(result.stopReason, "toolUse", result.errorMessage);
    assert.equal(result.provider, "anthropic-omp");
    assert.equal(result.content[0].name, "bash");
    assert.deepEqual(result.content[0].arguments, { command: "echo 🌍" });
    assert.equal(result.usage.input, 12);
    assert.equal(result.usage.output, 7);
    assert.equal(events.at(-1).type, "done");
    assert.equal(
      seen.find((event) => event.type === "content_block_start").content_block
        .name,
      "Bash",
    );
    assert.deepEqual(responseHeaders, [200]);
    const request = await h.requests[0].json();
    assert.equal(request.max_tokens, 1234);
    assert.equal(request.tools[0].name, "_Bash");
    assert.match(request.system[0].text, /x-anthropic-billing-header:/);
    assert.equal(request.system[2].text, "Use tools carefully");

    const followUp = {
      messages: [
        ...context.messages,
        result,
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "bash",
          content: [{ type: "text", text: "🌍" }],
          isError: false,
          timestamp: Date.now(),
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Also inspect this image" },
            { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
          ],
          timestamp: Date.now(),
        },
      ],
    };
    const next = h.provider.streamSimple(h.provider.getModels()[0], followUp, {
      apiKey: token,
      fetch: h.fetch,
    });
    for await (const _event of next) {
      // Consume the mocked second response like the agent loop would.
    }
    assert.equal((await next.result()).content[0].name, "bash");
    const nextRequest = await h.requests[1].json();
    const historyCall = nextRequest.messages
      .flatMap((message) => message.content)
      .find((block) => block.type === "tool_use");
    assert.equal(historyCall.name, "_Bash");
    assert.deepEqual(historyCall.input, { command: "echo 🌍" });
    const image = nextRequest.messages
      .flatMap((message) => message.content)
      .find((block) => block.type === "image");
    assert.deepEqual(image.source, {
      type: "base64",
      media_type: "image/png",
      data: "aW1hZ2U=",
    });
    assert.equal(result.content[0].name, "bash");
  },
);
