# Overview

Improve the Pi `lsp` extension so it discovers language workspaces in monorepos,
starts every needed explicit-language LSP instance asynchronously at session
start without blocking the UI, keeps open LSP documents fresh after Pi edits and
external filesystem changes, and splits the current large `index.ts` into
cohesive modules.

# Architecture

Keep the public `lsp` tool API explicit about `language`, but add a
workspace-discovery layer that finds per-language roots from project markers
such as `package.json`, `tsconfig.json`, `pyproject.toml`, `go.mod`, and Nix
files. On `session_start`, a server manager will kick off non-blocking
background startup for one `LspClient` per discovered `(language,
workspaceRoot)`; file-based operations route to the nearest matching root and
await that instance if it is still starting. A file-sync layer will listen to Pi
tool results and filesystem watcher events, invalidate formatter caches, and
refresh only already-open LSP documents unless a current operation explicitly
opens a file.

# Implementation plan

- explicit `language`, discovery-backed routing, async session-start server
  startup, filesystem watcher
- Keep `language` required in the tool schema for backward compatibility and
  predictable behavior.
- Discover all candidate LSP instances per workspace and language at
  `session_start`, then start them in background promises without awaiting the
  event handler so the UI remains usable immediately.
- LSP tool calls route to the already-scheduled instance and await it only if
  startup is still in progress.
- Add recursive workspace watchers with debounce so external edits,
  `bash`-driven edits, and Pi `edit`/`write` all refresh stale LSP documents.
- Trade-off: more processes are started up front, but there is no first-LSP-call
  startup surprise and this matches the desired behavior.

## Workspace discovery and monorepo routing

Add a discovery pass that scans below `ctx.cwd` with existing skip directories
(`node_modules`, `.git`, `dist`, `build`, `out`, `.nix`, `vendor`, `claudetmp`,
etc.) and records `WorkspaceInstance` entries:

```ts
type WorkspaceInstance = {
  language: string;
  root: string;
  marker: string;
};
```

Language marker mapping:

- TypeScript/JavaScript: `tsconfig.json`, `jsconfig.json`, `package.json`
- Python: `pyproject.toml`, `setup.cfg`, `setup.py`, `requirements.txt`
- Go: `go.mod`
- Nix: `flake.nix`, `default.nix`, `shell.nix`

For file-based actions, route to the nearest discovered root for the requested
language that contains the file. If no discovered root matches, fall back to the
language plugin’s ancestor root detection, bounded by `ctx.cwd` when possible
rather than walking unbounded to `/`. For query-only actions
(`workspace_symbol`, `definition`/`references` by query), use every discovered
instance for the requested language and aggregate or search results across them.

## Start servers asynchronously at session start by file type and workspace

Keep `language` explicit, but validate that a `file` is compatible with the
requested language plugin before routing to a server. For example, `language:
"typescript"` may accept `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`, `.cts`,
`.cjs`; `language: "python"` accepts `.py`/`.pyi`. The server key remains
`(language, workspaceRoot)`, not just language, so a monorepo can run separate
`frontend` and `admin-ui` TypeScript servers plus a `backend` Python server.

On `session_start`, discovery should finish quickly, then
`ServerManager.startAllInBackground(instances)` should schedule startup for
every discovered instance and return immediately. Tool calls should use the
matching startup promise and wait for it only if the server is still starting.
If a file has no matching discovered instance, report a clear
unsupported/no-workspace error rather than silently doing a lazy start;
`/reload` can rediscover new workspaces added after session start.

`/lsp-status` should show discovered startup state and failures, e.g.:

```text
typescript /repo/frontend starting
python     /repo/backend  running
nix        /repo          failed: nil not found
```

## Fresh LSP documents after edits, writes, and external changes

Use two refresh paths:

1. `tool_result` event for successful built-in `write` and `edit` calls. Extract
   `event.input.path`, resolve it against `ctx.cwd`, and notify the server
   manager immediately.
2. Filesystem watchers over discovered workspace roots. Watch directories
   recursively by installing per-directory `fs.watch` watchers with skip-dir
   filtering, debounce per path, and caps to avoid runaway watcher counts.

The refresh operation should:

- invalidate formatter line-preview cache for the path;
- refresh all running clients whose workspace root contains the changed path and
  whose language plugin accepts the file type;
- only update documents already open in that client, unless the active LSP
  operation explicitly asks to open the file;
- close/remove open documents when the file is deleted;
- ignore watcher refresh errors for paths that disappear during debounce.

Update `LspClient` document synchronization from stale `didClose`/`didOpen`
behavior to versioned document state:

```ts
private documentVersions = new Map<string, number>();

async refreshOpenDocument(filePath: string): Promise<void> {
  // if open and exists: send textDocument/didChange with incremented version
  // if open and deleted: send didClose and clear diagnostics/version/open state
}
```

Also reset per-URI diagnostics wait state before a refresh so `getDiagnostics()`
waits for diagnostics from the current file content instead of returning old
diagnostics.

## Formatter cache invalidation

`formatters.ts` currently caches file lines forever. Export a small invalidation helper:

```ts
export function invalidateFilePreviewCache(path?: string): void;
```

Call it from the file-sync layer and after LSP rename workspace edits. This
fixes stale preview lines in references/definitions even when the LSP document
itself is refreshed.

## Module organization

Move logic out of `index.ts` into cohesive modules:

- `types.ts`: shared LSP protocol-ish types (`Position`, `Range`, `Location`,
  `WorkspaceEdit`, `DocumentSymbol`, etc.) and action names.
- `tool-schema.ts`: `LspParams` TypeBox schema and prompt strings if keeping
  schema separate improves readability.
- `languages/types.ts`: `LanguagePlugin`, `IndexingTracker`, and language plugin
  metadata such as markers/extensions.
- `languages/utils.ts`: shared root/marker helpers currently duplicated in
  language plugins.
- `workspace-discovery.ts`: marker scanning, skip-dir handling, nearest-root
  selection, query-scope instance selection.
- `server-manager.ts`: owns `Map<serverKey, LspClient>`, async session-start
  startup promises, status, stop, refresh changed paths across running clients.
- `file-sync.ts`: Pi `tool_result` hook plus filesystem watcher
  lifecycle/debounce.
- `workspace-edits.ts`: workspace edit collection, text-edit application,
  mutation queue handling.
- `symbols.ts`: query symbol resolution, source-file fallback scan, definition
  implementation extraction.
- `actions.ts`: execute `definition`, `references`, `rename`,
  `document_symbols`, `workspace_symbol`, `completion`, `diagnostics` using the
  manager.
- `index.ts`: extension wiring only: create discovery/manager/sync, register
  tool, renderers, commands, shutdown cleanup.

# Files to modify

- `home-manager/pi-coding-agent/extensions/lsp/index.ts`
  - Reduce to registration/wiring.
  - Add `tool_result` hook through `file-sync.ts`.
  - Use `ServerManager` and `executeLspAction()` instead of inline helpers.

- `home-manager/pi-coding-agent/extensions/lsp/lsp-client.ts`
  - Track document versions.
  - Add `hasDocumentOpen(path)`, `refreshOpenDocument(path)`, and `closeDocument(path)`.
  - Clear diagnostics cache/wait state on refresh so diagnostics are current.
  - Prefer `textDocument/didChange` for already-open files.

- `home-manager/pi-coding-agent/extensions/lsp/formatters.ts`
  - Export preview cache invalidation.

- `home-manager/pi-coding-agent/extensions/lsp/languages/index.ts`
  - Extend `LanguagePlugin` with marker metadata and accepted extensions/language IDs as needed.

- `home-manager/pi-coding-agent/extensions/lsp/languages/{typescript,python,go,nix}.ts`
  - Add marker metadata.
  - Reuse shared root helper.
  - Bound ancestor search by project cwd where appropriate.

- New `home-manager/pi-coding-agent/extensions/lsp/types.ts`
  - Shared protocol/action types currently duplicated in `index.ts` and `formatters.ts` if practical.

- New `home-manager/pi-coding-agent/extensions/lsp/workspace-discovery.ts`
  - Marker scanning and nearest workspace selection.

- New `home-manager/pi-coding-agent/extensions/lsp/server-manager.ts`
  - Server lifecycle, routing, status, and refresh fan-out.

- New `home-manager/pi-coding-agent/extensions/lsp/file-sync.ts`
  - Filesystem watcher setup/teardown and Pi edit/write result handling.

- New `home-manager/pi-coding-agent/extensions/lsp/workspace-edits.ts`
  - Rename edit application helpers moved out of `index.ts`.

- New `home-manager/pi-coding-agent/extensions/lsp/symbols.ts`
  - Query symbol resolution and definition implementation formatting helpers.

- New `home-manager/pi-coding-agent/extensions/lsp/actions.ts`
  - Switch over LSP actions and return formatted/truncated result data.

# Verification, success criteria

1. After implementation and committing the changes, run the repository build command required by this repo:

   ```shell
   just build pi-coding-agent
   ```

   Expected: build succeeds.

2. Manual monorepo fixture check:
   - Create a temporary fixture under `claudetmp/lsp-monorepo-fixture` with:
     - `frontend/package.json` plus `frontend/src/app.ts`
     - `backend/pyproject.toml` plus `backend/app.py`
     - optional root `flake.nix`
   - Start Pi with the local extension or `/reload` the global extension.
   - Run `/lsp-status`.
   - Expected: status lists separate discovered instances for `frontend`
     TypeScript and `backend` Python, and startup begins immediately in the
     background with `starting`, `running`, or `failed` states rather than
     waiting for first use.

3. File-routed server usage check:
   - Call `lsp` with `language: "typescript"`, `action: "document_symbols"`,
     `file: "claudetmp/lsp-monorepo-fixture/frontend/src/app.ts"`.
   - Call `lsp` with `language: "python"`, `action: "document_symbols"`, `file:
     "claudetmp/lsp-monorepo-fixture/backend/app.py"`.
   - Expected: each call uses the already scheduled server rooted in its own
     subdirectory, awaiting it only if startup is still in progress;
     `/lsp-status` shows both roots as running after startup completes.

4. Stale-document check after Pi edit/write:
   - Use Pi `write` or `edit` to add or rename a symbol in an already-open fixture file.
   - Immediately call `lsp document_symbols`, `definition`, or `references` on that file.
   - Expected: output reflects the new file content and previews show updated lines.

5. External filesystem watcher check:
   - While Pi is running and the file is already open in an LSP client, modify the fixture file externally with a shell command or editor.
   - Wait for the debounce interval.
   - Call the relevant `lsp` action again.
   - Expected: LSP output and formatter previews reflect the external change without restarting the server.

6. Diagnostics freshness check:
   - Introduce a syntax/type error in an open file and call `lsp diagnostics`.
   - Fix the error via Pi edit/write or external edit and call `lsp diagnostics` again.
   - Expected: diagnostics update to the fixed state rather than returning the earlier stale error.

7. Cleanup check:
   - Run `/lsp-stop` and then exit/reload Pi.
   - Expected: all LSP processes and filesystem watchers are stopped without errors.


# Todo items

1. Extract shared LSP types and move workspace edit helpers out of `index.ts`.
2. Add language plugin marker metadata and shared root/ancestor helpers.
3. Implement workspace discovery for monorepo roots and nearest-root routing.
4. Implement `ServerManager` for async session-start `(language, root)` server
   lifecycle, startup promises, and status reporting.
5. Update `LspClient` document synchronization with versions, `didChange`, stale
   diagnostics reset, and close-on-delete handling.
6. Add formatter preview cache invalidation.
7. Implement file synchronization from successful `edit`/`write` tool results
   and debounced filesystem watchers.
8. Move action execution and symbol-resolution helpers into focused modules.
9. Wire the slim `index.ts` to run discovery and schedule background LSP startup
   on `session_start`, plus server manager, file sync, commands, renderers, and
   shutdown cleanup.
10. Verify with build plus manual monorepo, stale-document, watcher,
    diagnostics, and cleanup scenarios.
