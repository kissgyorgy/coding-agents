// Run with: node --experimental-vm-modules --test home-manager/pi-coding-agent/markdown-viewer.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";

async function createHarness(mode = "tui") {
  let component;
  let options;
  let renders = 0;
  let invalidations = 0;
  let requests = 0;
  const notifications = [];
  const keys = Object.fromEntries(
    ["escape", "enter", "up", "down", "pageUp", "pageDown", "home", "end"].map(
      (key) => [key, key],
    ),
  );
  const imports = {
    "@earendil-works/pi-coding-agent": { getMarkdownTheme: () => ({}) },
    "@earendil-works/pi-tui": {
      Key: keys,
      Markdown: class {
        constructor(content) {
          this.content = content;
        }
        render(width) {
          renders++;
          return this.content.split("\n").map((line) => line.slice(0, width));
        }
        invalidate() {
          invalidations++;
        }
      },
      matchesKey: (data, key) => data === key,
      truncateToWidth: (text, width) => [...text].slice(0, width).join(""),
      visibleWidth: (text) => [...text].length,
    },
  };
  const module = new SourceTextModule(
    stripTypeScriptTypes(
      readFileSync(
        new URL("./extensions/lib/markdown-viewer.ts", import.meta.url),
        "utf8",
      ),
    ),
  );
  await module.link((specifier) => {
    const exports = imports[specifier];
    assert.ok(exports, `Unexpected import: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) {
        this.setExport(name, value);
      }
    });
  });
  await module.evaluate();
  const tui = {
    terminal: { rows: 20 },
    requestRender: () => requests++,
  };
  const ctx = {
    mode,
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      custom: (factory, config) => {
        options = config;
        return new Promise((resolve) => {
          component = factory(
            tui,
            { fg: (_color, text) => text, bold: (text) => text },
            {},
            resolve,
          );
        });
      },
    },
  };
  return {
    open: (content) =>
      module.namespace.showMarkdownViewModal(ctx, "Test viewer", content),
    component: () => component,
    options: () => options,
    counts: () => ({ renders, invalidations, requests }),
    tui,
    notifications,
  };
}

test("uses the plan overlay layout, scrolls, resizes, and closes", async () => {
  const h = await createHarness();
  const pending = h.open(
    Array.from({ length: 40 }, (_value, i) => `Line ${i + 1}`).join("\n"),
  );
  assert.deepEqual(h.options(), {
    overlay: true,
    overlayOptions: { anchor: "center", width: "95%", maxHeight: "90%" },
  });
  const view = h.component();
  let lines = view.render(80);
  assert.equal(lines.length, 14);
  assert.match(lines[0], /Test viewer/);
  assert.match(lines[1], /Line 1 /);
  assert.match(lines.at(-1), /Esc close/);
  view.handleInput("down");
  assert.match(view.render(80)[1], /Line 2 /);
  view.handleInput("pageDown");
  assert.match(view.render(80)[1], /Line 14 /);
  view.handleInput("pageUp");
  assert.match(view.render(80)[1], /Line 2 /);
  view.handleInput("up");
  assert.match(view.render(80)[1], /Line 1 /);
  view.handleInput("end");
  lines = view.render(80);
  assert.match(lines[1], /Line 40 /);
  assert.ok(lines.slice(2, -1).every((line) => /^│ +│$/.test(line)));
  view.handleInput("down");
  assert.match(view.render(80)[1], /Line 40 /);
  h.tui.terminal.rows = 30;
  lines = view.render(80);
  assert.equal(lines.length, 24);
  assert.match(lines[1], /Line 40 /);
  view.handleInput("home");
  assert.match(view.render(80)[1], /Line 1 /);
  for (const width of [20, 10, 4, 2, 1]) {
    for (const line of view.render(width)) {
      assert.ok([...line].length <= width);
    }
  }
  view.invalidate();
  view.render(80);
  assert.equal(h.counts().invalidations, 1);
  assert.ok(h.counts().requests > 0);
  view.handleInput("escape");
  await pending;
});

test("allows scrolling past content even when it fits in the viewport", async () => {
  const h = await createHarness();
  const pending = h.open("First line\nLast line");
  const view = h.component();
  assert.match(view.render(80)[1], /First line/);
  view.handleInput("pageDown");
  const lines = view.render(80);
  assert.match(lines[0], /2–2\/2/);
  assert.match(lines[1], /Last line/);
  assert.ok(lines.slice(2, -1).every((line) => /^│ +│$/.test(line)));
  view.handleInput("home");
  assert.match(view.render(80)[1], /First line/);
  view.handleInput("escape");
  await pending;
});

test("Enter also closes the viewer", async () => {
  const h = await createHarness();
  const pending = h.open("Short content");
  h.component().render(80);
  h.component().handleInput("enter");
  await pending;
});

test("does not open a terminal overlay outside TUI mode", async () => {
  for (const mode of ["rpc", "json", "print"]) {
    const h = await createHarness(mode);
    await h.open("Content");
    assert.equal(h.component(), undefined);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].level, "warning");
  }
});
