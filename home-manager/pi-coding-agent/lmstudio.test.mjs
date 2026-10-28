// Run with: node --experimental-vm-modules --test home-manager/pi-coding-agent/lmstudio.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const source = stripTypeScriptTypes(
  readFileSync(new URL("./extensions/lmstudio.ts", import.meta.url), "utf8"),
);

function model(key, options = {}) {
  return {
    type: "llm",
    key,
    display_name: key,
    max_context_length: 131072,
    loaded_instances: [],
    ...options,
  };
}

async function createHarness(env = {}) {
  let provider;
  let available = { data: [] };
  let catalog = { models: [] };
  let failure;
  let status = 200;
  const requests = [];
  const streams = [];
  const context = createContext({
    process: { env },
    AbortSignal,
    URL,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      options.signal.throwIfAborted();
      if (failure) throw failure;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () =>
          url.endsWith("/api/v1/models") ? catalog : available,
      };
    },
  });
  const module = new SourceTextModule(source, { context });
  await module.link((specifier) => {
    assert.equal(specifier, "@earendil-works/pi-ai/compat");
    return new SyntheticModule(
      ["openAICompletionsApi"],
      function () {
        this.setExport("openAICompletionsApi", () => ({
          stream: (...args) => streams.push(["stream", ...args]),
          streamSimple: (...args) => streams.push(["streamSimple", ...args]),
        }));
      },
      { context },
    );
  });
  await module.evaluate();
  module.namespace.default({ registerProvider: (value) => (provider = value) });
  return {
    provider,
    requests,
    streams,
    setCatalog: (ids, models) => {
      available = { data: ids.map((id) => ({ id })) };
      catalog = { models };
    },
    setFailure: (error) => (failure = error),
    setStatus: (value) => (status = value),
    setInvalidCatalog: () => (catalog = {}),
    resolve: (credential) =>
      provider.auth.apiKey.resolve({
        credential,
        ctx: { env: async (name) => env[name] },
      }),
    login: (answers, signal = new AbortController().signal) =>
      provider.auth.apiKey.login({
        signal,
        prompt: async () => answers.shift(),
      }),
    refresh: (overrides = {}) =>
      provider.refreshModels({
        allowNetwork: true,
        signal: new AbortController().signal,
        publish: async ({ update }) => {
          update();
          return true;
        },
        ...overrides,
      }),
    models: () => JSON.parse(JSON.stringify(provider.getModels())),
  };
}

// Set PI_PACKAGE_DIR to an installed pi-coding-agent package to also exercise
// Pi's actual import aliases rather than just the isolated provider harness.
test(
  "loads and registers through Pi's real extension loader",
  { skip: !process.env.PI_PACKAGE_DIR },
  async () => {
    const { loadExtensions } = await import(
      pathToFileURL(
        `${process.env.PI_PACKAGE_DIR}/dist/core/extensions/loader.js`,
      ).href
    );
    const loaded = await loadExtensions(
      [fileURLToPath(new URL("./extensions/lmstudio.ts", import.meta.url))],
      process.cwd(),
    );
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.equal(
      loaded.runtime.pendingNativeProviderRegistrations[0].provider.id,
      "lmstudio",
    );
  },
);

test("discovers available chat models, aliases, context sizes and vision", async () => {
  const h = await createHarness();
  h.setCatalog(
    ["chat-alias", "vision", "embedding"],
    [
      model("publisher/chat", {
        loaded_instances: [
          { id: "chat-alias", config: { context_length: 32768 } },
        ],
      }),
      model("vision", { capabilities: { vision: true } }),
      model("embedding", { type: "embedding" }),
      model("unavailable"),
    ],
  );
  await h.refresh();
  const [chat, vision] = h.models();
  assert.equal(h.models().length, 2);
  assert.equal(chat.id, "chat-alias");
  assert.equal(chat.contextWindow, 32768);
  assert.equal(chat.maxTokens, 16384);
  assert.deepEqual(chat.input, ["text"]);
  assert.equal(vision.id, "vision");
  assert.equal(vision.contextWindow, 131072);
  assert.deepEqual(vision.input, ["text", "image"]);
  assert.equal(chat.baseUrl, "http://127.0.0.1:1234/v1");
  assert.equal(chat.api, "openai-completions");
  assert.equal(chat.provider, "lmstudio");
});

test("refresh replaces the list when models are loaded, unloaded or removed", async () => {
  const h = await createHarness();
  h.setCatalog(["first"], [model("first")]);
  await h.refresh();
  h.setCatalog(
    ["second", "another-instance"],
    [
      model("second", {
        loaded_instances: [
          { id: "second", config: { context_length: 8192 } },
          { id: "another-instance", config: { context_length: 4096 } },
        ],
      }),
    ],
  );
  await h.refresh();
  assert.deepEqual(
    h.models().map((entry) => entry.id),
    ["second", "another-instance"],
  );
  assert.equal(h.models()[1].maxTokens, 4096);
  h.setCatalog([], []);
  await h.refresh();
  assert.deepEqual(h.models(), []);
});

test("offline and aborted refreshes perform no network requests", async () => {
  const h = await createHarness();
  await h.refresh({ allowNetwork: false });
  await h.refresh({ signal: AbortSignal.abort() });
  assert.equal(h.requests.length, 0);
});

test("discovery failures retain the last successful model list", async () => {
  const h = await createHarness();
  h.setCatalog(["chat"], [model("chat")]);
  await h.refresh();
  const previous = h.models();
  h.setFailure(new Error("Server is offline"));
  await assert.rejects(h.refresh(), /Server is offline/);
  assert.deepEqual(h.models(), previous);
  h.setFailure(undefined);
  h.setInvalidCatalog();
  await assert.rejects(h.refresh(), /invalid model catalog/);
  assert.deepEqual(h.models(), previous);
  h.setCatalog(["chat"], [model("chat", { max_context_length: -1 })]);
  await assert.rejects(h.refresh(), /invalid context size/);
  assert.deepEqual(h.models(), previous);
});

test("a superseded publication cannot replace the catalog", async () => {
  const h = await createHarness();
  h.setCatalog(["chat"], [model("chat")]);
  await h.refresh({ publish: async () => false });
  assert.deepEqual(h.models(), []);
});

test("supports endpoint overrides and authenticates both catalog requests", async () => {
  const h = await createHarness({
    LMSTUDIO_BASE_URL: "http://localhost:9999/",
  });
  assert.equal(h.provider.baseUrl, "http://localhost:9999/v1");
  const resolve = (credential, key) =>
    h.provider.auth.apiKey.resolve({
      ctx: {
        env: async (name) => {
          return name === "LMSTUDIO_API_KEY" ? key : undefined;
        },
      },
      credential,
    });
  assert.equal((await resolve()).auth.apiKey, "lm-studio");
  assert.equal((await resolve(undefined, "env-key")).auth.apiKey, "env-key");
  assert.equal(
    (await resolve({ key: "stored-key" }, "env-key")).auth.apiKey,
    "stored-key",
  );
  await h.refresh({
    baseUrl: "http://localhost:7777/v1/",
    credential: { type: "api_key", key: "secret" },
  });
  assert.deepEqual(
    h.requests.map(({ url }) => url),
    ["http://localhost:7777/v1/models", "http://localhost:7777/api/v1/models"],
  );
  for (const request of h.requests) {
    assert.equal(request.headers.Authorization, "Bearer secret");
    assert.equal(request.signal.aborted, false);
  }
});

test("login normalizes and validates the URL and saves an optional API key", async () => {
  for (const enteredUrl of [
    " http://localhost:7777 ",
    "http://localhost:7777/v1/",
  ]) {
    const h = await createHarness();
    const prompts = [];
    const answers = [enteredUrl, " secret "];
    const credential = await h.provider.auth.apiKey.login({
      signal: new AbortController().signal,
      prompt: async (prompt) => {
        prompts.push(prompt);
        return answers.shift();
      },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(credential)), {
      type: "api_key",
      key: "secret",
      env: { LMSTUDIO_BASE_URL: "http://localhost:7777/v1" },
    });
    assert.equal(prompts[0].type, "text");
    assert.equal(prompts[1].type, "secret");
    assert.equal(prompts[0].placeholder, "http://127.0.0.1:1234/v1");
    assert.deepEqual(
      h.requests.map(({ url }) => url),
      [
        "http://localhost:7777/v1/models",
        "http://localhost:7777/api/v1/models",
      ],
    );
    assert.ok(
      h.requests.every(
        (request) => request.headers.Authorization === "Bearer secret",
      ),
    );
  }
});

test("blank login answers use the default URL and explicitly select keyless access", async () => {
  const h = await createHarness({ LMSTUDIO_API_KEY: "ambient-secret" });
  const credential = await h.login(["", "  "]);
  assert.equal(credential.env.LMSTUDIO_BASE_URL, "http://127.0.0.1:1234/v1");
  assert.equal(credential.key, "");
  assert.ok(
    h.requests.every((request) => request.headers.Authorization === undefined),
  );
  assert.equal((await h.resolve(credential)).auth.apiKey, "lm-studio");
});

test("saved connection takes precedence for both discovery and inference", async () => {
  const h = await createHarness({
    LMSTUDIO_BASE_URL: "http://ambient:9999",
    LMSTUDIO_API_KEY: "ambient-secret",
  });
  const credential = await h.login(["http://saved:7777", "saved-secret"]);
  const resolved = await h.resolve(credential);
  assert.equal(resolved.auth.baseUrl, "http://saved:7777/v1");
  assert.equal(resolved.auth.apiKey, "saved-secret");
  assert.equal(resolved.source, "stored credential");
  h.setCatalog(["chat"], [model("chat")]);
  await h.refresh({
    credential: {
      type: "api_key",
      key: resolved.auth.apiKey,
      env: resolved.env,
    },
    baseUrl: h.provider.baseUrl,
  });
  assert.equal(h.models()[0].baseUrl, resolved.auth.baseUrl);
  assert.ok(
    h.requests.every((request) => request.url.startsWith("http://saved:7777/")),
  );
  assert.ok(
    h.requests.every(
      (request) => request.headers.Authorization === "Bearer saved-secret",
    ),
  );
  const ambient = await h.resolve();
  assert.equal(ambient.auth.baseUrl, "http://ambient:9999/v1");
  assert.equal(ambient.auth.apiKey, "ambient-secret");
});

test("login rejects invalid URLs, failed validation and cancellation", async () => {
  const h = await createHarness();
  for (const url of ["not-a-url", "file:///tmp/model", "ftp://localhost"]) {
    await assert.rejects(h.login([url, ""]));
  }
  assert.equal(h.requests.length, 0);
  h.setStatus(401);
  await assert.rejects(h.login(["", "incorrect"]), /HTTP 401/);
  h.setStatus(200);
  h.setInvalidCatalog();
  await assert.rejects(h.login(["", ""]), /invalid model catalog/);
  h.setFailure(new Error("Server is offline"));
  await assert.rejects(h.login(["", ""]), /Server is offline/);
  const controller = new AbortController();
  controller.abort(new Error("Cancelled"));
  await assert.rejects(h.login(["", ""], controller.signal), /Cancelled/);
  await assert.rejects(
    h.provider.auth.apiKey.login({
      signal: new AbortController().signal,
      prompt: async () => {
        throw new Error("Prompt cancelled");
      },
    }),
    /Prompt cancelled/,
  );
});

test(
  "Pi persists login credentials, refreshes with them and returns to ambient auth on logout",
  { skip: !process.env.PI_PACKAGE_DIR },
  async () => {
    const { createModels, InMemoryCredentialStore } = await import(
      new URL(
        "../pi-ai/dist/index.js",
        pathToFileURL(`${process.env.PI_PACKAGE_DIR}/`),
      ).href
    );
    const h = await createHarness();
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(h.provider);
    const answers = ["http://saved:7777", "secret"];
    await models.login("lmstudio", "api_key", {
      prompt: async () => answers.shift(),
      notify: () => {},
    });
    const saved = await credentials.read("lmstudio");
    assert.equal(saved.env.LMSTUDIO_BASE_URL, "http://saved:7777/v1");
    assert.equal(saved.key, "secret");
    assert.equal(
      (await models.getAuth("lmstudio")).auth.baseUrl,
      "http://saved:7777/v1",
    );
    h.setCatalog(["chat"], [model("chat")]);
    const refreshed = await models.refresh({ providers: ["lmstudio"] });
    assert.equal(refreshed.errors.size, 0);
    assert.equal(
      (await models.getAvailable("lmstudio"))[0].baseUrl,
      "http://saved:7777/v1",
    );
    h.setStatus(401);
    const failedAnswers = ["http://wrong:7777", "wrong"];
    await assert.rejects(
      models.login("lmstudio", "api_key", {
        prompt: async () => failedAnswers.shift(),
        notify: () => {},
      }),
      /HTTP 401/,
    );
    assert.deepEqual(await credentials.read("lmstudio"), saved);
    await models.logout("lmstudio");
    assert.equal(await credentials.read("lmstudio"), undefined);
    assert.equal(
      (await models.getAuth("lmstudio")).auth.baseUrl,
      "http://127.0.0.1:1234/v1",
    );
  },
);

test("delegates streaming without dropping options or request hooks", async () => {
  const h = await createHarness();
  const args = [{ id: "chat" }, { messages: [] }, { apiKey: "key" }];
  h.provider.stream(...args);
  h.provider.streamSimple(...args);
  assert.deepEqual(h.streams, [
    ["stream", ...args],
    ["streamSimple", ...args],
  ]);
});
