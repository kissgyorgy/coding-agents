import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { FileSync } from "./file-sync.ts";
import { GitIgnoreFilter } from "./ignore-files.ts";
import * as nix from "./languages/nix.ts";
import * as python from "./languages/python.ts";
import * as rust from "./languages/rust.ts";
import { ServerManager } from "./server-manager.ts";
import { FILE_CHANGE_TYPE } from "./types.ts";

const execFileAsync = promisify(execFile);

async function createPythonProject() {
  const root = await mkdtemp(join(tmpdir(), "pi-lsp-diagnostics-"));
  const packageRoot = join(root, "probe");
  const mainPath = join(packageRoot, "main.py");
  const dependencyPath = join(packageRoot, "dependency.py");
  await mkdir(packageRoot);
  await writeFile(
    join(root, "pyproject.toml"),
    '[project]\nname = "probe"\nversion = "0"\n',
  );
  await writeFile(join(packageRoot, "__init__.py"), "");
  await writeFile(
    mainPath,
    "from .dependency import VALUE\n\nRESULT = VALUE\n",
  );
  return { root, mainPath, dependencyPath };
}

test("automatic diagnostics honor standard Git ignore files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pi-lsp-ignore-"));
  const ignoredDirectoryPath = join(root, "generated", "ignored.ts");
  const ignoredPatternPath = join(root, "src", "ignored.generated.ts");
  const unignoredPatternPath = join(root, "src", "keep.generated.ts");
  const excludedPath = join(root, "private.py");
  const includedPath = join(root, "src", "main.ts");
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await execFileAsync("git", ["init", "--quiet", root]);
  const ignoreFilter = new GitIgnoreFilter();
  await ignoreFilter.addDirectory(root);

  await mkdir(join(root, "generated"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, ".gitignore"), "generated/\n*.generated.ts\n");
  await writeFile(join(root, "src", ".gitignore"), "!keep.generated.ts\n");
  await mkdir(join(root, ".git", "info"), { recursive: true });
  await writeFile(join(root, ".git", "info", "exclude"), "private.py\n");
  for (const filePath of [
    ignoredDirectoryPath,
    ignoredPatternPath,
    unignoredPatternPath,
    excludedPath,
    includedPath,
  ]) {
    await writeFile(filePath, "export const value = 42;\n");
  }

  assert.deepEqual(
    await ignoreFilter.excludeIgnored([
      ignoredDirectoryPath,
      ignoredPatternPath,
      unignoredPatternPath,
      excludedPath,
      includedPath,
    ]),
    [unignoredPatternPath, includedPath],
  );
});

test(
  "diagnostics are refreshed after a new imported file is created",
  { timeout: 20_000 },
  async (context) => {
    const project = await createPythonProject();
    const manager = new ServerManager({ python });
    context.after(async () => {
      await manager.stop();
      await rm(project.root, { recursive: true, force: true });
    });

    manager.setDiscoveredInstances([
      {
        language: "python",
        root: project.root,
        marker: "pyproject.toml",
      },
    ]);
    const { client } = await manager.getClientForFile(
      project.root,
      "python",
      project.mainPath,
    );
    const initialDiagnostics = await client.getDiagnostics(project.mainPath);
    assert.ok(
      initialDiagnostics.some((diagnostic) =>
        diagnostic.message.includes(
          'Import ".dependency" could not be resolved',
        ),
      ),
    );

    await writeFile(project.dependencyPath, "VALUE = 42\n");
    await manager.refreshFile(
      project.root,
      project.dependencyPath,
      FILE_CHANGE_TYPE.Created,
    );

    const results = await manager.getDiagnosticsForChangedPaths(project.root, [
      project.mainPath,
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].error, undefined);
    assert.deepEqual(results[0].diagnostics, []);
  },
);

test(
  "diagnostics handle Python files excluded from workspace analysis",
  { timeout: 20_000 },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "pi-lsp-excluded-python-"));
    const sourceRoot = join(root, "src");
    const excludedRoot = join(root, "claudetmp");
    const filePath = join(excludedRoot, "probe.py");
    await mkdir(sourceRoot);
    await mkdir(excludedRoot);
    await writeFile(
      join(root, "pyproject.toml"),
      '[project]\nname = "probe"\nversion = "0"\n',
    );
    await writeFile(
      join(root, "pyrightconfig.json"),
      '{ "include": ["src"] }\n',
    );
    await writeFile(join(sourceRoot, "included.py"), "VALUE = 42\n");
    await writeFile(filePath, "VALUE: str = 42\n");

    const manager = new ServerManager({ python });
    context.after(async () => {
      await manager.stop();
      await rm(root, { recursive: true, force: true });
    });
    manager.setDiscoveredInstances([
      { language: "python", root, marker: "pyproject.toml" },
    ]);

    await manager.refreshFile(root, filePath, FILE_CHANGE_TYPE.Created);
    const [result] = await manager.getDiagnosticsForChangedPaths(root, [
      filePath,
    ]);

    assert.equal(result.error, undefined);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "reportAssignmentType",
      ),
    );
  },
);

test("write tool synchronization reports newly created files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pi-lsp-file-sync-"));
  const filePath = join(root, "created.ts");
  const refreshes = [];
  const manager = {
    async refreshFile(cwd, path, changeType) {
      refreshes.push({ cwd, path, changeType });
    },
    async refreshChangedPath() {},
  };
  const fileSync = new FileSync(manager, { debounceMs: 10 });
  context.after(async () => {
    fileSync.stop();
    await rm(root, { recursive: true, force: true });
  });

  fileSync.beginAgentRun();
  const event = {
    toolCallId: "write-created-file",
    toolName: "write",
    args: { path: filePath },
  };
  fileSync.handleToolExecutionStart(event, root);
  await writeFile(filePath, "export const value = 42;\n");
  await fileSync.handleToolExecutionEnd({ ...event, isError: false }, root);

  assert.deepEqual(refreshes, [
    {
      cwd: root,
      path: filePath,
      changeType: FILE_CHANGE_TYPE.Created,
    },
  ]);
});

test("filesystem watcher reports files created outside tools", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pi-lsp-watcher-"));
  const filePath = join(root, "created.py");
  const refreshes = [];
  const manager = {
    async refreshFile() {},
    async refreshChangedPath(path, changeType) {
      refreshes.push({ path, changeType });
    },
  };
  const fileSync = new FileSync(manager, {
    debounceMs: 10,
    maxQuietWaitMs: 1000,
  });
  context.after(async () => {
    fileSync.stop();
    await rm(root, { recursive: true, force: true });
  });

  fileSync.start([{ language: "python", root, marker: "pyproject.toml" }]);
  fileSync.beginAgentRun();
  await writeFile(filePath, "VALUE = 42\n");
  const changedPaths = await fileSync.takeChangedPathsAfterQuiet();

  assert.ok(changedPaths.includes(filePath));
  assert.ok(
    refreshes.some(
      (refresh) =>
        refresh.path === filePath &&
        refresh.changeType === FILE_CHANGE_TYPE.Created,
    ),
  );
});

test(
  "diagnostics work when a server ignores same-content changes",
  { timeout: 20_000 },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "pi-lsp-nix-diagnostics-"));
    const filePath = join(root, "flake.nix");
    await writeFile(filePath, "{ outputs = { self }: { broken = ; }; }\n");

    const manager = new ServerManager({ nix });
    context.after(async () => {
      await manager.stop();
      await rm(root, { recursive: true, force: true });
    });
    manager.setDiscoveredInstances([
      { language: "nix", root, marker: "flake.nix" },
    ]);

    await manager.refreshFile(root, filePath, FILE_CHANGE_TYPE.Created);
    const [result] = await manager.getDiagnosticsForChangedPaths(root, [
      filePath,
    ]);

    assert.equal(result.error, undefined);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "syntax_error",
      ),
    );

    await writeFile(filePath, "{ outputs = { self }: {}; }\n");
    await manager.refreshFile(root, filePath, FILE_CHANGE_TYPE.Changed);
    const [fixedResult] = await manager.getDiagnosticsForChangedPaths(root, [
      filePath,
    ]);
    assert.equal(fixedResult.error, undefined);
    assert.deepEqual(fixedResult.diagnostics, []);
  },
);

test(
  "diagnostics wait for rust-analyzer to replace provisional results",
  { timeout: 30_000 },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "pi-lsp-rust-diagnostics-"));
    const sourceDir = join(root, "src");
    const filePath = join(sourceDir, "main.rs");
    await mkdir(sourceDir);
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n',
    );
    await writeFile(
      filePath,
      'fn main() {\n    let value: String = 42;\n    println!("{value}");\n}\n',
    );

    const manager = new ServerManager({ rust });
    context.after(async () => {
      await manager.stop();
      await rm(root, { recursive: true, force: true });
    });
    manager.setDiscoveredInstances([
      { language: "rust", root, marker: "Cargo.toml" },
    ]);

    await manager.refreshFile(root, filePath, FILE_CHANGE_TYPE.Created);
    const [result] = await manager.getDiagnosticsForChangedPaths(root, [
      filePath,
    ]);

    assert.equal(result.error, undefined);
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.code === "E0308"),
    );

    await writeFile(
      filePath,
      'fn main() {\n    let value: String = "ok".to_owned();\n    println!("{value}");\n}\n',
    );
    await manager.refreshFile(root, filePath, FILE_CHANGE_TYPE.Changed);
    const [fixedResult] = await manager.getDiagnosticsForChangedPaths(root, [
      filePath,
    ]);
    assert.equal(fixedResult.error, undefined);
    assert.deepEqual(fixedResult.diagnostics, []);
  },
);
