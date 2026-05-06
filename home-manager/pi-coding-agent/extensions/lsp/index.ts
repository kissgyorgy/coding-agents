import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { executeLspAction, type LspParams as LspToolParams } from "./actions";
import { FileSync } from "./file-sync";
import { getSupportedLanguages } from "./languages";
import { ServerManager } from "./server-manager";
import { LspParamsSchema } from "./tool-schema";
import { discoverWorkspaceInstances } from "./workspace-discovery";

export default function (pi: ExtensionAPI) {
  const manager = new ServerManager();
  const fileSync = new FileSync(manager);

  pi.on("session_start", async (_event, ctx) => {
    const instances = discoverWorkspaceInstances(ctx.cwd);
    manager.startAllInBackground(instances);
    fileSync.start(instances);
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
      "LSP operations (definition, references, rename, symbols, diagnostics) for nix, python, typescript, and go",
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
