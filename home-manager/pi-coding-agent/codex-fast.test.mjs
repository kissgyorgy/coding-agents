// Run with: node --experimental-vm-modules --test home-manager/pi-coding-agent/codex-fast.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";

const source = stripTypeScriptTypes(
  readFileSync(new URL("./extensions/codex-fast.ts", import.meta.url), "utf8"),
);

async function createHarness(provider = "openai-codex", id = "gpt-6.1-sol") {
  const handlers = new Map();
  const commands = new Map();
  const entries = [];
  const notifications = [];
  let status;
  let autocomplete;
  let settings;
  // Mock persistence and Pi's sole runtime import, so tests need neither an
  // installed Pi package nor access to the user's real Fast-mode setting.
  const imports = {
    "node:fs": {
      existsSync: () => settings !== undefined,
      mkdirSync: () => {},
      readFileSync: () => settings,
      writeFileSync: (_path, value) => {
        settings = value;
      },
    },
    "node:path": { join },
    "@earendil-works/pi-coding-agent": { getAgentDir: () => "/mock-agent" },
  };
  const module = new SourceTextModule(source);
  await module.link((specifier) => {
    const exports = imports[specifier];
    assert.ok(exports, `Unexpected runtime import: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) {
        this.setExport(name, value);
      }
    });
  });
  await module.evaluate();
  module.namespace.default({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) =>
      entries.push({ type: "custom", customType, data }),
  });
  const ctx = {
    model: { provider, id },
    sessionManager: { getEntries: () => entries },
    ui: {
      theme: { fg: (_color, text) => text },
      setStatus: (_key, text) => {
        status = text;
      },
      notify: (text, level) => notifications.push({ text, level }),
      addAutocompleteProvider: (factory) => {
        autocomplete = factory({
          getSuggestions: () => ({
            items: [{ label: "fast" }, { label: "other" }],
            prefix: "/",
          }),
        });
      },
    },
  };
  const emit = (name, event = {}) => handlers.get(name)(event, ctx);
  await emit("session_start");
  return {
    ctx,
    emit,
    notifications,
    toggle: () => commands.get("fast").handler("", ctx),
    status: () => status,
    suggestions: async () =>
      (await autocomplete.getSuggestions(["/"], 0, 1)).items.map(
        (item) => item.label,
      ),
    request: (payload = { model: ctx.model.id }) =>
      emit("before_provider_request", { payload }),
  };
}

for (const provider of ["openai", "openai-codex"]) {
  for (const id of ["gpt-5.6", "gpt-6.1-sol"]) {
    test(`${provider}/${id} exposes /fast and applies priority only when enabled`, async () => {
      const h = await createHarness(provider, id);
      assert.equal(h.status(), "🐢 fast off");
      assert.deepEqual(await h.suggestions(), ["fast", "other"]);
      assert.equal(h.request(), undefined);
      await h.toggle();
      assert.equal(h.status(), "⚡fast");
      const payload = { model: id, input: [], service_tier: "auto" };
      assert.deepEqual(h.request(payload), {
        ...payload,
        service_tier: "priority",
      });
      assert.equal(payload.service_tier, "auto");
      for (const invalid of [
        null,
        [],
        {},
        { model: "gpt-4.1" },
        { model: 6 },
      ]) {
        assert.equal(h.request(invalid), undefined);
      }
      await h.toggle();
      assert.equal(h.request(), undefined);
    });
  }
}

test("unsupported providers and model families remain ineligible", async () => {
  for (const [provider, id] of [
    ["openrouter", "gpt-6.1-sol"],
    ["openai-codex", "gpt-4.1"],
  ]) {
    const h = await createHarness(provider, id);
    assert.equal(h.status(), undefined);
    assert.deepEqual(await h.suggestions(), ["other"]);
    await h.toggle();
    assert.equal(h.notifications.at(-1).level, "warning");
    assert.equal(h.request(), undefined);
  }
});

test("model switching updates eligibility without losing the Fast setting", async () => {
  const h = await createHarness();
  await h.toggle();
  h.ctx.model = { provider: "openrouter", id: "gpt-6.1-sol" };
  await h.emit("model_select");
  assert.equal(h.status(), undefined);
  assert.deepEqual(await h.suggestions(), ["other"]);
  assert.equal(h.request(), undefined);
  h.ctx.model = { provider: "openai", id: "gpt-6.1-sol" };
  await h.emit("model_select");
  assert.equal(h.status(), "⚡fast");
  assert.deepEqual(await h.suggestions(), ["fast", "other"]);
  assert.equal(h.request().service_tier, "priority");
});
