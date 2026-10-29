// Run with: node --experimental-vm-modules --test home-manager/pi-coding-agent/inspect.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";

async function loadModule(url) {
  const source = stripTypeScriptTypes(readFileSync(url, "utf8"));
  const module = new SourceTextModule(source);
  await module.link((specifier) => {
    if (specifier === "../lib/markdown-viewer.js") {
      return new SyntheticModule(["showMarkdownViewModal"], function () {
        this.setExport("showMarkdownViewModal", async (ctx, title, content) => {
          ctx.views.push({ title, content });
        });
      });
    }
    assert.ok(specifier.startsWith("./"), `Unexpected import: ${specifier}`);
    return loadModule(new URL(specifier.replace(/\.js$/, ".ts"), url));
  });
  return module;
}

async function createHarness() {
  const commands = new Map();
  const views = [];
  const notifications = [];
  let tools = [];
  let active = [];
  let availableCommands = [];
  const module = await loadModule(
    new URL("./extensions/inspect/index.ts", import.meta.url),
  );
  await module.evaluate();
  module.namespace.default({
    registerCommand: (name, command) => commands.set(name, command),
    getAllTools: () => tools,
    getActiveTools: () => active,
    getCommands: () => availableCommands,
    sendMessage: () =>
      assert.fail("Inspection must not add conversation messages"),
  });
  const ctx = {
    views,
    getSystemPrompt: () => "System prompt\nverbatim.",
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
    },
  };
  return {
    commands,
    views,
    notifications,
    ctx,
    setTools: (registered, enabled) => {
      tools = registered;
      active = enabled;
    },
    setCommands: (registered) => {
      availableCommands = registered;
    },
    run: (name) => commands.get(name).handler("", ctx),
  };
}

test("registers the available inspect commands", async () => {
  const h = await createHarness();
  assert.deepEqual([...h.commands.keys()].sort(), [
    "inspect:tools",
  ]);
});

test("lists only active tools alphabetically with descriptions and readable parameters", async () => {
  const h = await createHarness();
  const readParameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to read." },
      limit: { type: "number", description: "Optional line limit." },
    },
    required: ["path"],
  };
  const tools = [
    { name: "z_hidden", exposure: "hidden", description: "Hidden tool." },
    {
      name: "read",
      exposure: "direct",
      description: "Read files.\nAlso images.",
      parameters: readParameters,
    },
    {
      name: "question",
      exposure: "model-only",
      description: "Ask the user.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "docs_search",
      exposure: "codemode",
      namespace: { name: "mcp__docs" },
      description: "Search documentation.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "deferred_search",
      exposure: "deferred",
      description: "Search later.",
    },
    { name: "inactive_direct", exposure: "direct", description: "Inactive." },
  ];
  h.setTools(Object.freeze(tools), ["read", "question", "docs_search"]);
  await h.run("inspect:tools");
  assert.equal(h.views.length, 1);
  const { title, content } = h.views[0];
  assert.equal(title, "Active tools (3)");
  assert.match(content, /^- `docs_search`/);
  const entries = content.split(/^- /m).slice(1);
  assert.equal(entries.length, 3);
  assert.match(entries[0], /^`docs_search` — namespace: mcp__docs/);
  assert.match(entries[0], /\n  No parameters\.\n\n  Search documentation\./);
  assert.match(
    entries[1],
    /^`question`\n  No parameters\.\n\n  Ask the user\./,
  );
  assert.equal(
    entries[2],
    [
      "`read`",
      "  - `path` (string, required) — Path to read.",
      "  - `limit` (number, optional) — Optional line limit.",
      "",
      "  Read files.",
      "  Also images.",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(content, /exposure|```|"properties"|"required"/);
  assert.doesNotMatch(content, /z_hidden|deferred_search|inactive_direct/);
});

test("renders nested object and list parameters with local required flags and nullable types", async () => {
  const h = await createHarness();
  h.setTools(
    [
      {
        name: "example",
        exposure: "direct",
        description: "Example tool.",
        parameters: {
          type: "object",
          required: ["edits"],
          properties: {
            edits: {
              type: "array",
              description: "Changes to apply.",
              items: {
                type: "object",
                required: ["oldText"],
                properties: {
                  oldText: { type: "string", description: "Text\nto match." },
                  newText: { type: "string" },
                },
              },
            },
            settings: {
              type: "object",
              properties: { enabled: { type: "boolean" } },
            },
            timeout: { anyOf: [{ type: "number" }, { type: "null" }] },
            label: { type: ["string", "null"] },
            data: {},
          },
        },
      },
    ],
    ["example"],
  );
  await h.run("inspect:tools");
  const content = h.views[0].content;
  for (const line of [
    "  - `edits` (list of object values, required) — Changes to apply.",
    "    - `oldText` (string, required) — Text to match.",
    "    - `newText` (string, optional)",
    "  - `settings` (object, optional)",
    "    - `enabled` (boolean, optional)",
    "  - `timeout` (number or null, optional)",
    "  - `label` (string or null, optional)",
    "  - `data` (any value, optional)",
  ]) {
    assert.ok(content.includes(line), `Missing parameter: ${line}`);
  }
  assert.doesNotMatch(content, /```/);
});

test("reads the current tool registry and active set on every invocation", async () => {
  const h = await createHarness();
  await h.run("inspect:tools");
  assert.deepEqual(h.views[0], {
    title: "Active tools (0)",
    content: "No active tools.",
  });
  const tools = [
    {
      name: "late_tool",
      exposure: "direct",
      description: "Late.",
      parameters: { type: "object", properties: {} },
    },
  ];
  h.setTools(tools, ["late_tool"]);
  await h.run("inspect:tools");
  assert.equal(h.views[1].title, "Active tools (1)");
  assert.match(h.views[1].content, /`late_tool`/);
  h.setTools(tools, []);
  await h.run("inspect:tools");
  assert.equal(h.views[2].title, "Active tools (0)");
  assert.match(h.views[2].content, /No active tools\./);
  assert.doesNotMatch(h.views[2].content, /late_tool/);
});

