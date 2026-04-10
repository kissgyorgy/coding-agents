import { StringEnum } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { LspClient, getSupportedLanguages } from "./lsp-client";
import {
  formatHover,
  formatReferences,
  formatRename,
  formatDocumentSymbols,
  formatWorkspaceSymbol,
  formatCompletion,
  formatDiagnostics,
} from "./formatters";

const ACTIONS = [
  "hover",
  "definition",
  "references",
  "rename",
  "document_symbols",
  "workspace_symbol",
  "completion",
  "diagnostics",
] as const;

type Action = (typeof ACTIONS)[number];

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Location = { uri: string; range: Range };
type LocationLink = {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange: Range;
};
type DocumentSymbol = {
  name: string;
  kind: number;
  range?: Range;
  selectionRange?: Range;
  children?: DocumentSymbol[];
  location?: Location;
};

type TextEdit = {
  range: Range;
  newText: string;
};

type WorkspaceEdit = {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: (
    | {
        textDocument: { uri: string; version?: number | null };
        edits: TextEdit[];
      }
    | { kind: string; uri?: string; oldUri?: string; newUri?: string }
  )[];
};

const LspParams = Type.Object({
  language: Type.String({
    description: `Language to use. Supported: ${getSupportedLanguages().join(", ")}`,
  }),
  action: StringEnum([...ACTIONS]),
  file: Type.Optional(
    Type.String({
      description:
        "File path (relative to cwd). Required for: hover, definition, references, rename, document_symbols, completion, diagnostics",
    }),
  ),
  line: Type.Optional(
    Type.Number({
      description:
        "1-based line number. Required for: hover, definition, references, rename, completion",
    }),
  ),
  character: Type.Optional(
    Type.Number({
      description:
        "1-based column number. Required for: hover, definition, references, rename, completion",
    }),
  ),
  new_name: Type.Optional(
    Type.String({ description: "New name for rename action" }),
  ),
  query: Type.Optional(
    Type.String({ description: "Search query for workspace_symbol action" }),
  ),
});

function requireFile(file?: string): string {
  if (!file) throw new Error("'file' parameter is required for this action");
  return file.startsWith("@") ? file.slice(1) : file;
}

function requirePosition(
  line?: number,
  character?: number,
): { line: number; character: number } {
  if (line === undefined || character === undefined)
    throw new Error(
      "'line' and 'character' parameters are required for this action (1-based)",
    );
  return { line: line - 1, character: character - 1 };
}

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function findNearestContainingDir(
  startDir: string,
  stopDir: string,
  fileNames: string[],
): string | null {
  let current = resolve(startDir);
  const limit = resolve(stopDir);

  while (true) {
    for (const fileName of fileNames) {
      if (existsSync(join(current, fileName))) return current;
    }
    if (current === limit) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    if (!current.startsWith(limit)) return null;
    current = parent;
  }
}

function rangeContains(range: Range, pos: Position): boolean {
  if (pos.line < range.start.line || pos.line > range.end.line) return false;
  if (pos.line === range.start.line && pos.character < range.start.character)
    return false;
  if (pos.line === range.end.line && pos.character > range.end.character)
    return false;
  return true;
}

function rangeSize(range: Range): number {
  return (
    (range.end.line - range.start.line) * 100000 +
    (range.end.character - range.start.character)
  );
}

function findBestSymbolRange(
  symbols: DocumentSymbol[],
  pos: Position,
): Range | null {
  let best: Range | null = null;

  const visit = (symbol: DocumentSymbol) => {
    const bodyRange = symbol.range ?? symbol.location?.range;
    const selectionRange = symbol.selectionRange ?? symbol.location?.range;
    if (bodyRange && selectionRange && rangeContains(selectionRange, pos)) {
      if (!best || rangeSize(bodyRange) < rangeSize(best)) {
        best = bodyRange;
      }
    }

    for (const child of symbol.children ?? []) {
      visit(child);
    }
  };

  for (const symbol of symbols) {
    visit(symbol);
  }

  return best;
}

function getRangeText(path: string, range: Range): string | null {
  try {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    const startLine = lines[range.start.line];
    const endLine = lines[range.end.line];
    if (startLine === undefined || endLine === undefined) return null;

    if (range.start.line === range.end.line) {
      return startLine.slice(range.start.character, range.end.character);
    }

    const parts = [startLine.slice(range.start.character)];
    for (let i = range.start.line + 1; i < range.end.line; i++) {
      parts.push(lines[i] ?? "");
    }
    parts.push(endLine.slice(0, range.end.character));
    return parts.join("\n");
  } catch {
    return null;
  }
}

function languageFromPath(path: string): string {
  const ext = extname(path);
  if (ext === ".py" || ext === ".pyi") return "python";
  if (ext === ".nix") return "nix";
  return "text";
}

function getLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === "\r") {
      if (content[i + 1] === "\n") i++;
      offsets.push(i + 1);
    } else if (char === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function getLineContentEnd(
  content: string,
  lineOffsets: number[],
  line: number,
): number {
  let end =
    line + 1 < lineOffsets.length ? lineOffsets[line + 1] : content.length;
  if (end > 0 && content[end - 1] === "\n") end--;
  if (end > 0 && content[end - 1] === "\r") end--;
  return end;
}

function positionToOffset(
  content: string,
  lineOffsets: number[],
  pos: Position,
): number {
  if (pos.line < 0 || pos.line >= lineOffsets.length) {
    throw new Error(
      `Invalid edit position ${pos.line + 1}:${pos.character + 1}`,
    );
  }

  const lineStart = lineOffsets[pos.line];
  const lineEnd = getLineContentEnd(content, lineOffsets, pos.line);
  const clampedCharacter = Math.min(
    pos.character,
    Math.max(0, lineEnd - lineStart),
  );
  return lineStart + clampedCharacter;
}

function applyTextEdits(
  content: string,
  edits: TextEdit[],
  path: string,
): string {
  const lineOffsets = getLineOffsets(content);
  const normalized = edits.map((edit, index) => {
    const start = positionToOffset(content, lineOffsets, edit.range.start);
    const end = positionToOffset(content, lineOffsets, edit.range.end);
    if (end < start) {
      throw new Error(
        `Invalid edit range in ${path} at ${edit.range.start.line + 1}:${edit.range.start.character + 1}`,
      );
    }
    return { ...edit, start, end, index };
  });

  normalized.sort(
    (a, b) => a.start - b.start || a.end - b.end || a.index - b.index,
  );
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i].start < normalized[i - 1].end) {
      throw new Error(`Overlapping rename edits in ${path}`);
    }
  }

  normalized.sort(
    (a, b) => b.start - a.start || b.end - a.end || b.index - a.index,
  );

  let updated = content;
  for (const edit of normalized) {
    updated =
      updated.slice(0, edit.start) + edit.newText + updated.slice(edit.end);
  }
  return updated;
}

function collectWorkspaceEditChanges(
  edit: WorkspaceEdit,
): Map<string, TextEdit[]> {
  const files = new Map<string, TextEdit[]>();

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      files.set(uriToPath(uri), [...edits]);
    }
  }

  for (const change of edit.documentChanges ?? []) {
    if (!("edits" in change)) {
      throw new Error(`Unsupported workspace edit operation: ${change.kind}`);
    }
    const path = uriToPath(change.textDocument.uri);
    const existing = files.get(path) ?? [];
    existing.push(...change.edits);
    files.set(path, existing);
  }

  return files;
}

async function withFileMutationQueues<T>(
  paths: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const uniquePaths = [...new Set(paths)].sort();

  const run = async (index: number): Promise<T> => {
    if (index >= uniquePaths.length) return fn();
    return withFileMutationQueue(uniquePaths[index], () => run(index + 1));
  };

  return run(0);
}

async function applyWorkspaceEdit(
  edit: WorkspaceEdit,
  client: LspClient,
): Promise<void> {
  const fileEdits = collectWorkspaceEditChanges(edit);
  const paths = [...fileEdits.keys()];
  if (paths.length === 0) return;

  await withFileMutationQueues(paths, async () => {
    const nextContents = new Map<string, string>();

    for (const path of paths) {
      const content = readFileSync(path, "utf8");
      const next = applyTextEdits(content, fileEdits.get(path) ?? [], path);
      nextContents.set(path, next);
    }

    for (const path of paths) {
      writeFileSync(path, nextContents.get(path) ?? "", "utf8");
    }

    for (const path of paths) {
      await client.refreshDocument(path);
    }
  });
}

async function formatDefinitionWithImplementation(
  result: unknown,
  client: LspClient,
): Promise<string> {
  if (!result) return "No definition found.";

  const locations = Array.isArray(result) ? result : [result];
  if (locations.length === 0) return "No definition found.";

  const symbolCache = new Map<string, DocumentSymbol[]>();
  const sections: string[] = [];
  const seen = new Set<string>();

  for (const location of locations as Array<Location | LocationLink>) {
    let path: string;
    let bodyRange: Range | null = null;
    let selectionPos: Position;

    if ("targetUri" in location) {
      path = uriToPath(location.targetUri);
      bodyRange = location.targetRange;
      selectionPos = location.targetSelectionRange.start;
    } else {
      path = uriToPath(location.uri);
      selectionPos = location.range.start;
    }

    if (!bodyRange) {
      let symbols = symbolCache.get(path);
      if (!symbols) {
        const rawSymbols = (await client.documentSymbols(
          path,
        )) as DocumentSymbol[];
        symbols = Array.isArray(rawSymbols) ? rawSymbols : [];
        symbolCache.set(path, symbols);
      }
      bodyRange = findBestSymbolRange(symbols, selectionPos);
    }

    const range = bodyRange ?? { start: selectionPos, end: selectionPos };
    const key = `${path}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const text = bodyRange ? getRangeText(path, bodyRange) : null;
    if (text) {
      sections.push(
        `${path}:${bodyRange.start.line + 1}\n\n\`\`\`${languageFromPath(path)}\n${text}\n\`\`\``,
      );
    } else {
      sections.push(`${path}:${selectionPos.line + 1}`);
    }
  }

  return sections.join("\n\n");
}

export default function (pi: ExtensionAPI) {
  const servers = new Map<string, LspClient>();

  function getWorkspaceRoot(
    language: string,
    ctx: ExtensionContext,
    file?: string,
  ): string {
    if (!file) return ctx.cwd;

    const normalized = file.startsWith("@") ? file.slice(1) : file;
    const absoluteFile = resolve(ctx.cwd, normalized);
    const fileDir = dirname(absoluteFile);

    if (language === "python") {
      return fileDir;
    }

    if (language === "typescript") {
      return (
        findNearestContainingDir(fileDir, ctx.cwd, [
          "tsconfig.json",
          "jsconfig.json",
          "package.json",
        ]) ?? fileDir
      );
    }

    return ctx.cwd;
  }

  async function getServer(
    language: string,
    workspaceRoot: string,
  ): Promise<LspClient> {
    const key = `${language}:${workspaceRoot}`;
    let client = servers.get(key);
    if (client?.isRunning()) return client;

    client = new LspClient(language, workspaceRoot);
    servers.set(key, client);
    await client.start();
    return client;
  }

  pi.on("session_shutdown", async () => {
    for (const [, client] of servers) {
      await client.stop().catch(() => {});
    }
    servers.clear();
  });

  pi.registerTool({
    name: "lsp",
    label: "LSP",
    description: `Language Server Protocol tool. Starts LSP servers on demand and provides editor-like features: hover info, go-to-definition, find references, rename symbols, list document/workspace symbols, completions, and diagnostics. Supported languages: ${getSupportedLanguages().join(", ")}. Line and character numbers are 1-based.`,
    promptSnippet:
      "LSP operations (hover, definition, references, rename, symbols, diagnostics) for nix, python, and typescript",
    promptGuidelines: [
      "Use the lsp tool for refactoring operations like rename, finding references, and go-to-definition instead of grep-based approaches when working with nix, python, or typescript files.",
      "Before renaming a symbol, use 'references' to see all usages, then use 'rename' to apply the workspace edit returned by the language server.",
      "Line and character numbers for the lsp tool are 1-based (matching what the read tool shows).",
    ],
    parameters: LspParams,

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
      const { language, action } = params;
      const workspaceRoot = getWorkspaceRoot(language, ctx, params.file);

      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Starting LSP for ${language}...`,
          },
        ],
      });

      let client: LspClient;
      try {
        client = await getServer(language, workspaceRoot);
      } catch (e: unknown) {
        throw new Error(
          `Failed to start ${language} LSP server: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Running ${action}...`,
          },
        ],
      });

      let resultText: string;

      switch (action as Action) {
        case "hover": {
          const file = requireFile(params.file);
          const pos = requirePosition(params.line, params.character);
          const result = await client.hover(file, pos.line, pos.character);
          resultText = formatHover(result);
          break;
        }

        case "definition": {
          const file = requireFile(params.file);
          const pos = requirePosition(params.line, params.character);
          const result = await client.definition(file, pos.line, pos.character);
          resultText = await formatDefinitionWithImplementation(result, client);
          break;
        }

        case "references": {
          const file = requireFile(params.file);
          const pos = requirePosition(params.line, params.character);
          const result = await client.references(file, pos.line, pos.character);
          resultText = formatReferences(result);
          break;
        }

        case "rename": {
          const file = requireFile(params.file);
          const pos = requirePosition(params.line, params.character);
          if (!params.new_name)
            throw new Error("'new_name' parameter is required for rename");
          const result = (await client.rename(
            file,
            pos.line,
            pos.character,
            params.new_name,
          )) as WorkspaceEdit | null;
          if (!result) {
            resultText = "No rename changes generated.";
            break;
          }
          try {
            await applyWorkspaceEdit(result, client);
          } catch (error) {
            throw new Error(
              `Failed to apply rename edits: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          resultText = formatRename(result);
          break;
        }

        case "document_symbols": {
          const file = requireFile(params.file);
          const result = await client.documentSymbols(file);
          resultText = formatDocumentSymbols(result);
          break;
        }

        case "workspace_symbol": {
          const result = await client.workspaceSymbol(params.query ?? "");
          resultText = formatWorkspaceSymbol(result);
          break;
        }

        case "completion": {
          const file = requireFile(params.file);
          const pos = requirePosition(params.line, params.character);
          const result = await client.completion(file, pos.line, pos.character);
          resultText = formatCompletion(result);
          break;
        }

        case "diagnostics": {
          const file = requireFile(params.file);
          const diags = await client.getDiagnostics(file);
          resultText = formatDiagnostics(diags);
          break;
        }

        default:
          throw new Error(
            `Unknown action: ${action}. Supported: ${ACTIONS.join(", ")}`,
          );
      }

      const truncation = truncateHead(resultText, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      return {
        content: [{ type: "text", text: truncation.content }],
        details: { language, action },
      };
    },
  });

  pi.registerCommand("lsp-status", {
    description: "Show running LSP servers",
    handler: async (_args, ctx) => {
      if (servers.size === 0) {
        ctx.ui.notify("No LSP servers running", "info");
        return;
      }
      const lines: string[] = [];
      for (const [key, client] of servers) {
        const status = client.isRunning() ? "running" : "stopped";
        lines.push(`  ${key}: ${status}`);
      }
      ctx.ui.notify(`LSP servers:\n${lines.join("\n")}`, "info");
    },
  });

  pi.registerCommand("lsp-stop", {
    description: "Stop LSP servers (optionally specify language)",
    handler: async (args, ctx) => {
      if (args) {
        const matching = [...servers.entries()].filter(
          ([key]) => key === args || key.startsWith(`${args}:`),
        );
        if (matching.length > 0) {
          for (const [key, client] of matching) {
            await client.stop().catch(() => {});
            servers.delete(key);
          }
          ctx.ui.notify(
            `Stopped ${matching.length} ${args} LSP server(s)`,
            "info",
          );
          return;
        }
      }

      for (const [, client] of servers) {
        await client.stop().catch(() => {});
      }
      servers.clear();
      ctx.ui.notify("Stopped all LSP servers", "info");
    },
  });
}
