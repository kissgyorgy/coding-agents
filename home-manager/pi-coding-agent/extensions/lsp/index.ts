import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { executeLspAction, type LspParams as LspToolParams } from "./actions";
import { FileSync } from "./file-sync";
import { getSupportedLanguages } from "./languages";
import { ServerManager } from "./server-manager";
import { LspParamsSchema } from "./tool-schema";
import {
  discoverWorkspaceInstancesAsync,
  workspaceKey,
  type WorkspaceInstance,
} from "./workspace-discovery";

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

export default function (pi: ExtensionAPI) {
  if (!isInsideGitWorkTree(process.cwd())) return;

  const manager = new ServerManager();
  const fileSync = new FileSync(manager);

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

  pi.on("session_start", (_event, ctx) => {
    void discoverAndStartDirectory(ctx.cwd).catch(() => {});
  });

  pi.on("tool_result", async (event, ctx) => {
    fileSync.handleToolResult(event, ctx.cwd);
  });

  pi.on("session_shutdown", async () => {
    fileSync.stop();
    await manager.stop().catch(() => {});
  });

  pi.registerTool({
    name: "lsp",
    label: "LSP",
    description: `Language Server Protocol tool. Starts LSP servers on demand and provides editor-like features: go-to-definition, find references, rename symbols, list document/workspace symbols, completions, and diagnostics. Supported languages: ${getSupportedLanguages().join(", ")}. Line and character numbers are 1-based. Both 'definition' and 'references' support 'query' to look up symbols by name without file/position.`,
    promptSnippet:
      "LSP operations (definition, references, rename, symbols, diagnostics) for nix, python, typescript, go, and rust",
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
