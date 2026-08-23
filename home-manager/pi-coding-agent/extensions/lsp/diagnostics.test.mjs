import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileSync } from "./file-sync.ts";
import * as python from "./languages/python.ts";
import { ServerManager } from "./server-manager.ts";
import { FILE_CHANGE_TYPE } from "./types.ts";

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
