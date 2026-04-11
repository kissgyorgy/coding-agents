import { StringEnum } from "@mariozechner/pi-ai";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { LspClient } from "./lsp-client";
import {
  languages,
  getSupportedLanguages,
  type LanguagePlugin,
} from "./languages";
import {
  formatReferences,
  formatRename,
  formatDocumentSymbols,
  formatWorkspaceSymbol,
  formatCompletion,
  formatDiagnostics,
} from "./formatters";

const ACTIONS = [
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
        "File path (relative to cwd). Required for: references, rename, document_symbols, completion, diagnostics. Optional for definition (uses query instead).",
    }),
  ),
  line: Type.Optional(
    Type.Number({
      description:
        "1-based line number. Required for: references, rename, completion. Optional for definition (uses query instead).",
    }),
  ),
  character: Type.Optional(
    Type.Number({
      description:
        "1-based column number. Required for: references, rename, completion. Optional for definition (uses query instead).",
    }),
  ),
  new_name: Type.Optional(
    Type.String({ description: "New name for rename action" }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Symbol name for definition (when file not provided) or search query for workspace_symbol",
    }),
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

type SymbolInformation = {
  name: string;
  kind: number;
  location?: Location;
  containerName?: string;
};

function findBestSymbolMatch(
  symbols: unknown,
  query: string,
): SymbolInformation | null {
  const items = Array.isArray(symbols) ? symbols : [];
  if (items.length === 0) return null;

  const exact = items.filter((s: SymbolInformation) => s.name === query);
  if (exact.length > 0) return exact[0] as SymbolInformation;

  const lower = query.toLowerCase();
  const caseMatch = items.filter(
    (s: SymbolInformation) => s.name.toLowerCase() === lower,
  );
  if (caseMatch.length > 0) return caseMatch[0] as SymbolInformation;

  return items[0] as SymbolInformation;
}

async function findSymbolInOpenFiles(
  client: LspClient,
  query: string,
): Promise<SymbolInformation | null> {
  const paths = client.getOpenDocumentPaths();
  const lower = query.toLowerCase();
  let best: SymbolInformation | null = null;

  for (const path of paths) {
    let rawSymbols: unknown;
    try {
      rawSymbols = await client.documentSymbols(path);
    } catch {
      continue;
    }

    const symbols = Array.isArray(rawSymbols) ? rawSymbols : [];
    const visit = (items: DocumentSymbol[]) => {
      for (const sym of items) {
        const nameRange = sym.selectionRange ?? sym.range;
        const loc: Location | undefined =
          sym.location ??
          (nameRange
            ? {
                uri: pathToFileURL(path).href,
                range: nameRange,
              }
            : undefined);
        if (sym.name === query && loc) {
          best = { name: sym.name, kind: sym.kind, location: loc };
          return;
        }
        if (sym.name.toLowerCase() === lower && !best && loc) {
          best = { name: sym.name, kind: sym.kind, location: loc };
        }
        if (sym.children) visit(sym.children);
      }
    };
    visit(symbols as DocumentSymbol[]);
    if (best?.name === query) return best;
  }

  return best;
}

function getLanguageForPath(path: string): string {
  for (const plugin of Object.values(languages)) {
    const id = plugin.languageIdForPath(path);
    if (id) return id;
  }
  return "text";
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".nix",
  "vendor",
  "claudetmp",
]);

function findSourceFiles(
  rootDir: string,
  extensions: Set<string>,
  maxFiles = 50,
  maxDepth = 5,
): string[] {
  const results: string[] = [];

  function scan(dir: string, depth: number) {
    if (results.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        scan(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (extensions.has(ext)) {
          results.push(join(dir, entry.name));
        }
      }
    }
  }

  scan(rootDir, 0);
  return results;
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
        `${path}:${bodyRange.start.line + 1}\n\n\`\`\`${getLanguageForPath(path)}\n${text}\n\`\`\``,
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
    const startDir = file
      ? dirname(resolve(ctx.cwd, file.startsWith("@") ? file.slice(1) : file))
      : ctx.cwd;

    const plugin = languages[language];
    if (plugin) return plugin.getWorkspaceRoot(startDir, ctx);
    return ctx.cwd;
  }

  async function getServer(
    language: string,
    workspaceRoot: string,
  ): Promise<LspClient> {
    const key = `${language}:${workspaceRoot}`;
    let client = servers.get(key);
    if (client?.isRunning()) return client;

    const plugin = languages[language];
    if (!plugin) throw new Error(`Unsupported language: ${language}`);

    client = new LspClient(
      language,
      plugin.getConfig(workspaceRoot),
      languages,
      plugin.createIndexingTracker?.(),
    );
    servers.set(key, client);
    await client.start();
    return client;
  }

  async function resolveSymbolLocation(
    language: string,
    ctx: ExtensionContext,
    query: string,
    signal?: AbortSignal,
  ): Promise<{ location: Location; client: LspClient }> {
    const exts = languages[language]?.fileExtensions ?? new Set<string>();
    const workspaceRoot = getWorkspaceRoot(language, ctx);
    const client = await getServer(language, workspaceRoot);

    if (client.openDocumentCount() === 0) {
      for (const f of findSourceFiles(workspaceRoot, exts)) {
        if (signal?.aborted) throw new Error("Aborted");
        await client.ensureDocumentOpen(f);
      }
    }

    let match: SymbolInformation | null = null;

    try {
      const symbols = await client.workspaceSymbol(query, signal);
      match = findBestSymbolMatch(symbols, query);
    } catch {
      // workspace/symbol may fail without project config (e.g. tsserver)
    }

    if (!match) {
      match = await findSymbolInOpenFiles(client, query);
    }

    if (!match?.location) throw new Error(`Symbol not found: ${query}`);

    const symbolPath = uriToPath(match.location.uri);
    const symbolRoot = getWorkspaceRoot(language, ctx, symbolPath);
    const symbolClient = await getServer(language, symbolRoot);

    if (symbolClient.openDocumentCount() === 0) {
      for (const f of findSourceFiles(symbolRoot, exts)) {
        if (signal?.aborted) throw new Error("Aborted");
        await symbolClient.ensureDocumentOpen(f);
      }
    }

    return { location: match.location, client: symbolClient };
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

      await client.waitForIndexing(30000, signal);

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
        case "definition": {
          if (params.file) {
            const file = requireFile(params.file);
            const pos = requirePosition(params.line, params.character);
            const result = await client.definition(
              file,
              pos.line,
              pos.character,
              signal,
            );
            resultText = await formatDefinitionWithImplementation(
              result,
              client,
            );
          } else {
            if (!params.query)
              throw new Error(
                "'query' (symbol name) is required for definition when 'file' is not provided",
              );
            const { location, client: symbolClient } =
              await resolveSymbolLocation(language, ctx, params.query, signal);
            resultText = await formatDefinitionWithImplementation(
              [location],
              symbolClient,
            );
          }
          break;
        }

        case "references": {
          if (params.file) {
            const file = requireFile(params.file);
            const pos = requirePosition(params.line, params.character);
            const result = await client.references(
              file,
              pos.line,
              pos.character,
              true,
              signal,
            );
            resultText = formatReferences(result);
          } else {
            if (!params.query)
              throw new Error(
                "'query' (symbol name) is required for references when 'file' is not provided",
              );
            const { location, client: refClient } = await resolveSymbolLocation(
              language,
              ctx,
              params.query,
              signal,
            );
            const result = await refClient.references(
              uriToPath(location.uri),
              location.range.start.line,
              location.range.start.character,
              true,
              signal,
            );
            resultText = formatReferences(result);
          }
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
            signal,
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
          const result = await client.documentSymbols(file, signal);
          resultText = formatDocumentSymbols(result);
          break;
        }

        case "workspace_symbol": {
          const result = await client.workspaceSymbol(
            params.query ?? "",
            signal,
          );
          resultText = formatWorkspaceSymbol(result);
          break;
        }

        case "completion": {
          const file = requireFile(params.file);
          const pos = requirePosition(params.line, params.character);
          const result = await client.completion(
            file,
            pos.line,
            pos.character,
            signal,
          );
          resultText = formatCompletion(result);
          break;
        }

        case "diagnostics": {
          const file = requireFile(params.file);
          const diags = await client.getDiagnostics(file, signal);
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

      const lines = resultText.split("\n");
      const headerLine = lines[0] ?? "";
      let inCodeBlock = false;
      const sigLines: string[] = [];
      for (const line of lines.slice(1)) {
        const trimmed = line.trim();
        if (trimmed.startsWith("``")) {
          if (inCodeBlock) break;
          inCodeBlock = true;
          continue;
        }
        if (!inCodeBlock) continue;
        if (!trimmed) continue;
        sigLines.push(line);
        if (
          trimmed.endsWith("{") ||
          trimmed.endsWith(")") ||
          trimmed.endsWith(";") ||
          trimmed.endsWith(":")
        )
          break;
      }
      const summary =
        sigLines.length > 0
          ? headerLine + "\n" + sigLines.join("\n")
          : headerLine;

      return {
        content: [{ type: "text", text: truncation.content }],
        details: { language, action, summary },
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
