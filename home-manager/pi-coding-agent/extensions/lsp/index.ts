import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Loader, Text } from "@earendil-works/pi-tui";
import { executeLspAction, type LspParams as LspToolParams } from "./actions";
import { FileSync } from "./file-sync";
import { formatDiagnostics } from "./formatters";
import { getSupportedLanguages } from "./languages";
import { ServerManager, type FileDiagnostics } from "./server-manager";
import { LspParamsSchema } from "./tool-schema";
import {
  discoverWorkspaceInstancesAsync,
  workspaceKey,
  type WorkspaceInstance,
} from "./workspace-discovery";

class DiagnosticsLoader extends Loader {
  override render(width: number): string[] {
    // The widget container supplies the blank line above. Move Loader's own
    // leading blank below the message to match Pi's status + editor spacing.
    return [...super.render(width).slice(1), ""];
  }

  dispose(): void {
    this.stop();
  }
}

function normalizeCommandPath(cwd: string, args: string | undefined): string {
  const path = args?.trim();
  if (!path) throw new Error("Usage: /lsp:add-dir <path-to-code-directory>");

  const normalized = path.startsWith("@") ? path.slice(1) : path;
  if (normalized === "~") return homedir();
  if (normalized.startsWith("~/")) return join(homedir(), normalized.slice(2));
  return resolve(cwd, normalized);
}

function mergeWorkspaceInstances(
  current: WorkspaceInstance[],
  next: WorkspaceInstance[],
): WorkspaceInstance[] {
  const byKey = new Map<string, WorkspaceInstance>();
  for (const instance of current) {
    byKey.set(workspaceKey(instance.language, instance.root), instance);
  }
  for (const instance of next) {
    byKey.set(workspaceKey(instance.language, instance.root), instance);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.language.localeCompare(b.language) ||
      a.root.localeCompare(b.root) ||
      a.marker.localeCompare(b.marker),
  );
}

async function pathIsDirectory(path: string): Promise<boolean> {
  return (await stat(path)).isDirectory();
}

function isInsideGitWorkTree(directory: string): boolean {
  try {
    const stdout = execFileSync(
      "git",
      ["-C", directory, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

function displayPath(filePath: string, cwd: string): string {
  const path = relative(cwd, filePath);
  return path && path !== ".." && !path.startsWith("../") ? path : filePath;
}

function formatAutomaticDiagnostics(
  results: FileDiagnostics[],
  cwd: string,
): string {
  const lines = [
    "Automatic LSP diagnostics for files changed during the completed agent run:",
  ];

  for (const result of results) {
    lines.push(`\n${displayPath(result.filePath, cwd)} (${result.language}):`);
    if (result.error) {
      lines.push(`  Diagnostics failed: ${result.error}`);
      continue;
    }

    for (const line of formatDiagnostics(result.diagnostics).split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  if (!isInsideGitWorkTree(process.cwd())) return;

  const manager = new ServerManager();
  const fileSync = new FileSync(manager);
  let diagnosticsController: AbortController | undefined;
  let diagnosticsLoader: DiagnosticsLoader | undefined;

  async function discoverAndStartDirectory(
    directory: string,
    ctx?: {
      ui?: {
        notify: (message: string, level: "info" | "warning" | "error") => void;
      };
    },
  ): Promise<void> {
    const discovered = await discoverWorkspaceInstancesAsync(directory);
    if (discovered.length === 0) {
      ctx?.ui?.notify(
        `No LSP workspaces discovered under ${directory}`,
        "warning",
      );
      return;
    }

    const merged = mergeWorkspaceInstances(
      manager.getDiscoveredInstances(),
      discovered,
    );
    manager.startAllInBackground(merged);
    fileSync.start(merged);

    ctx?.ui?.notify(
      `Added ${discovered.length} LSP workspace(s) from ${directory}:\n${manager.formatStatus()}`,
      "info",
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    await discoverAndStartDirectory(ctx.cwd).catch(() => {});
  });

  pi.on("agent_start", () => {
    fileSync.beginAgentRun();
  });

  pi.on("tool_execution_start", (event, ctx) => {
    fileSync.handleToolExecutionStart(event, ctx.cwd);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    await fileSync.handleToolExecutionEnd(event, ctx.cwd);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const changedPaths = await fileSync.takeChangedPathsAfterQuiet();
    if (changedPaths.length === 0) return;

    diagnosticsController?.abort();
    const controller = new AbortController();
    diagnosticsController = controller;

    if (ctx.mode === "tui") {
      ctx.ui.setWidget("lsp-diagnostics", (tui, theme) => {
        diagnosticsLoader?.stop();
        diagnosticsLoader = new DiagnosticsLoader(
          tui,
          (spinner) => theme.fg("accent", spinner),
          (message) => theme.fg("muted", message),
          `Running LSP diagnostics for ${changedPaths.length} changed path(s)…`,
        );
        return diagnosticsLoader;
      });
    }

    try {
      const results = await manager.getDiagnosticsForChangedPaths(
        ctx.cwd,
        changedPaths,
        controller.signal,
      );
      if (controller.signal.aborted || results.length === 0) return;

      const failures = results.filter((result) => result.error);
      if (failures.length > 0) {
        ctx.ui.notify(
          `lsp: diagnostics failed for ${failures.length} changed file(s): ${failures[0].error}`,
          "warning",
        );
      }

      const reportable = results.filter(
        (result) => !result.error && result.diagnostics.length > 0,
      );
      if (reportable.length === 0) {
        if (failures.length === 0) {
          ctx.ui.notify("lsp: diagnostics done", "info");
        }
        return;
      }

      const report = truncateHead(
        formatAutomaticDiagnostics(reportable, ctx.cwd),
      );
      const truncationNote = report.truncated
        ? "\n\n[Diagnostics truncated to the tool output limit.]"
        : "";
      pi.sendMessage(
        {
          customType: "lsp-diagnostics",
          content: report.content + truncationNote,
          display: true,
        },
        { triggerTurn: true },
      );
    } finally {
      if (diagnosticsController === controller) {
        diagnosticsController = undefined;
        diagnosticsLoader?.stop();
        diagnosticsLoader = undefined;
        ctx.ui.setWidget("lsp-diagnostics", undefined);
      }
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    diagnosticsController?.abort();
    diagnosticsController = undefined;
    diagnosticsLoader?.stop();
    diagnosticsLoader = undefined;
    ctx.ui.setWidget("lsp-diagnostics", undefined);
    fileSync.stop();
    await manager.stop().catch(() => {});
  });

  pi.registerTool({
    name: "lsp",
    label: "LSP",
    description: `Language Server Protocol tool. Starts LSP servers on demand and provides editor-like features: go-to-definition, find references, rename symbols, list document/workspace symbols, and completions. Supported languages: ${getSupportedLanguages().join(", ")}. Line and character numbers are 1-based. Both 'definition' and 'references' support 'query' to look up symbols by name without file/position.`,
    promptSnippet:
      "LSP operations (definition, references, rename, symbols, completions) for nix, python, typescript, go, and rust",
    promptGuidelines: [
      "ALWAYS use the lsp tool FOR ANY coding related action instead grep-based approaches.",
      "IMPORTANT: USE lsp tool instead of read or ripgrep for searching code snippets, functions, variables or symbols in code.",
      "Use 'definition' or 'references' with a 'query' parameter to look up symbols by name. 'definition' returns the implementation body, 'references' returns all usages. 'workspace_symbol' only lists names and locations.",
      "Before renaming a symbol, use 'references' to see all usages, then use 'rename' to apply the workspace edit returned by the language server.",
      "Line and character numbers for the lsp tool are 1-based (matching what the read tool shows).",
    ],
    parameters: LspParamsSchema,

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("lsp "));
      text += theme.fg("accent", `${args.language} `);
      text += theme.fg("muted", args.action);

      if (args.file) {
        text += theme.fg("dim", ` ${args.file}`);
      }

      if (args.line !== undefined && args.character !== undefined) {
        text += theme.fg("dim", `:${args.line}:${args.character}`);
      }

      if (args.new_name) {
        text += theme.fg("dim", ` -> ${args.new_name}`);
      }

      if (args.query) {
        text += theme.fg("dim", ` ${JSON.stringify(args.query)}`);
      }

      return new Text(text, 0, 0);
    },

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await executeLspAction(
        params as LspToolParams,
        manager,
        ctx,
        signal,
        onUpdate,
      );

      return {
        content: [{ type: "text", text: result.content }],
        details: result.details,
      };
    },

    renderResult(result, options, theme) {
      const textContent = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");

      if (!options.expanded) {
        const summary =
          (result.details as { summary?: string }).summary ??
          textContent.split("\n")[0] ??
          "";
        return new Text(theme.fg("toolOutput", summary), 0, 0);
      }

      return new Text(theme.fg("toolOutput", textContent), 0, 0);
    },
  });

  pi.registerCommand("lsp:status", {
    description: "Show discovered LSP servers",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`LSP servers:\n${manager.formatStatus()}`, "info");
    },
  });

  pi.registerCommand("lsp:add-dir", {
    description: "Discover and start LSP servers for a code directory",
    handler: async (args, ctx) => {
      let directory: string;
      try {
        directory = normalizeCommandPath(ctx.cwd, args);
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
        return;
      }

      try {
        if (!(await pathIsDirectory(directory))) {
          ctx.ui.notify(`LSP path is not a directory: ${directory}`, "error");
          return;
        }
      } catch (error) {
        ctx.ui.notify(
          `Cannot access LSP directory ${directory}: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }

      ctx.ui.notify(`Scanning ${directory} for LSP workspaces...`, "info");
      void discoverAndStartDirectory(directory, ctx).catch((error) => {
        ctx.ui.notify(
          `Failed to add LSP directory ${directory}: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      });
    },
  });

  pi.registerCommand("lsp:stop", {
    description: "Stop LSP servers (optionally specify language)",
    handler: async (args, ctx) => {
      const stopped = await manager.stop(args || undefined);
      if (args) {
        ctx.ui.notify(`Stopped ${stopped} ${args} LSP server(s)`, "info");
        return;
      }
      fileSync.stop();
      ctx.ui.notify("Stopped all LSP servers", "info");
    },
  });
}
