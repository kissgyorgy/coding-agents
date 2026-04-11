import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Location {
  uri: string;
  range: Range;
}

interface Range {
  start: Position;
  end: Position;
}

interface Position {
  line: number;
  character: number;
}

interface MarkupContent {
  kind: "plaintext" | "markdown";
  value: string;
}

interface LocationLink {
  targetUri: string;
  targetRange: Range;
  targetSelectionRange: Range;
}

interface SymbolInfo {
  name: string;
  kind: number;
  location?: Location;
  containerName?: string;
  children?: SymbolInfo[];
  range?: Range;
  selectionRange?: Range;
  detail?: string;
}

interface TextEdit {
  range: Range;
  newText: string;
}

interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: (
    | { textDocument: { uri: string; version?: number }; edits: TextEdit[] }
    | { kind: string; uri: string; newUri?: string }
  )[];
}

interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | MarkupContent;
  insertText?: string;
}

interface CompletionResult {
  isIncomplete?: boolean;
  items: CompletionItem[];
}

interface Diagnostic {
  range: Range;
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
}

const SYMBOL_KINDS: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
};

const COMPLETION_KINDS: Record<number, string> = {
  1: "Text",
  2: "Method",
  3: "Function",
  4: "Constructor",
  5: "Field",
  6: "Variable",
  7: "Class",
  8: "Interface",
  9: "Module",
  10: "Property",
  11: "Unit",
  12: "Value",
  13: "Enum",
  14: "Keyword",
  15: "Snippet",
  16: "Color",
  17: "File",
  18: "Reference",
  19: "Folder",
  20: "EnumMember",
  21: "Constant",
  22: "Struct",
  23: "Event",
  24: "Operator",
  25: "TypeParameter",
};

const SEVERITY_LABELS: Record<number, string> = {
  1: "Error",
  2: "Warning",
  3: "Information",
  4: "Hint",
};

const fileLinesCache = new Map<string, string[]>();

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function posStr(pos: Position): string {
  return `${pos.line + 1}:${pos.character + 1}`;
}

function locStr(loc: Location): string {
  return `${uriToPath(loc.uri)}:${posStr(loc.range.start)}`;
}

function getFileLines(path: string): string[] | null {
  const cached = fileLinesCache.get(path);
  if (cached) return cached;

  try {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    fileLinesCache.set(path, lines);
    return lines;
  } catch {
    return null;
  }
}

function truncatePreview(text: string, maxLength = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function getLinePreview(path: string, _range: Range): string | null {
  const lines = getFileLines(path);
  if (!lines) return null;

  const line = lines[_range.start.line];
  if (line === undefined) return null;

  return truncatePreview(line);
}

function formatLocationWithPreview(loc: Location): string[] {
  const path = uriToPath(loc.uri);
  const preview = getLinePreview(path, loc.range);
  const lines = [`  ${path}:${posStr(loc.range.start)}`];
  if (preview) lines.push(`    ${preview}`);
  return lines;
}

function formatLocationLinkWithPreview(loc: LocationLink): string[] {
  const path = uriToPath(loc.targetUri);
  const range = loc.targetSelectionRange ?? loc.targetRange;
  const preview = getLinePreview(path, range);
  const lines = [`  ${path}:${posStr(range.start)}`];
  if (preview) lines.push(`    ${preview}`);
  return lines;
}

export function formatDefinition(result: unknown): string {
  if (!result) return "No definition found.";

  const locations = Array.isArray(result) ? result : [result];
  if (locations.length === 0) return "No definition found.";

  const lines = [`Found ${locations.length} definition(s):`];
  for (const loc of locations as Array<Location | LocationLink>) {
    if ("uri" in loc) {
      lines.push(...formatLocationWithPreview(loc));
    } else if ("targetUri" in loc) {
      lines.push(...formatLocationLinkWithPreview(loc));
    }
  }
  return lines.join("\n");
}

export function formatReferences(result: unknown): string {
  if (!result) return "No references found.";

  const locations = result as Location[];
  if (locations.length === 0) return "No references found.";

  const grouped = new Map<string, Location[]>();
  for (const loc of locations) {
    const path = uriToPath(loc.uri);
    const refs = grouped.get(path) ?? [];
    refs.push(loc);
    grouped.set(path, refs);
  }

  const lines = [
    `Found ${locations.length} reference(s) in ${grouped.size} file(s):`,
  ];
  for (const [path, refs] of grouped) {
    lines.push(`\n  ${path}:`);
    for (const ref of refs) {
      lines.push(
        `    ${ref.range.start.line + 1}:${ref.range.start.character + 1}`,
      );
      const preview = getLinePreview(path, ref.range);
      if (preview) lines.push(`      ${preview}`);
    }
  }
  return lines.join("\n");
}

export function formatRename(result: unknown): string {
  if (!result) return "Rename not supported or no changes.";

  const edit = result as WorkspaceEdit;
  const lines: string[] = [];

  if (edit.changes) {
    let totalEdits = 0;
    for (const [uri, edits] of Object.entries(edit.changes)) {
      lines.push(`\n  ${uriToPath(uri)}: ${edits.length} edit(s)`);
      for (const e of edits) {
        lines.push(`    ${e.range.start.line + 1}: "${e.newText}"`);
      }
      totalEdits += edits.length;
    }
    lines.unshift(
      `Applied ${totalEdits} edit(s) in ${Object.keys(edit.changes).length} file(s):`,
    );
  } else if (edit.documentChanges) {
    let totalEdits = 0;
    let fileCount = 0;
    for (const change of edit.documentChanges) {
      if ("edits" in change) {
        fileCount++;
        lines.push(
          `\n  ${uriToPath(change.textDocument.uri)}: ${change.edits.length} edit(s)`,
        );
        for (const e of change.edits) {
          lines.push(`    ${e.range.start.line + 1}: "${e.newText}"`);
        }
        totalEdits += change.edits.length;
      }
    }
    lines.unshift(`Applied ${totalEdits} edit(s) in ${fileCount} file(s):`);
  }

  return lines.length > 0 ? lines.join("\n") : "No rename changes generated.";
}

function formatSymbolTree(symbols: SymbolInfo[], indent = ""): string[] {
  const lines: string[] = [];
  for (const sym of symbols) {
    const kind = SYMBOL_KINDS[sym.kind] ?? `Kind(${sym.kind})`;
    const detail = sym.detail ? ` - ${sym.detail}` : "";
    const range = sym.selectionRange ?? sym.range;
    const loc = range ? ` (line ${range.start.line + 1})` : "";
    lines.push(`${indent}${kind} ${sym.name}${detail}${loc}`);
    if (sym.children) {
      lines.push(...formatSymbolTree(sym.children, indent + "  "));
    }
  }
  return lines;
}

export function formatDocumentSymbols(result: unknown): string {
  if (!result) return "No symbols found.";

  const symbols = result as SymbolInfo[];
  if (symbols.length === 0) return "No symbols found.";

  const lines = [`Found ${symbols.length} symbol(s):`];
  lines.push(...formatSymbolTree(symbols, "  "));
  return lines.join("\n");
}

export function formatWorkspaceSymbol(result: unknown): string {
  if (!result) return "No symbols found.";

  const symbols = result as SymbolInfo[];
  if (symbols.length === 0) return "No matching symbols.";

  const lines = [`Found ${symbols.length} symbol(s):`];
  for (const sym of symbols) {
    const kind = SYMBOL_KINDS[sym.kind] ?? `Kind(${sym.kind})`;
    const container = sym.containerName ? ` in ${sym.containerName}` : "";
    const loc = sym.location ? ` at ${locStr(sym.location)}` : "";
    lines.push(`  ${kind} ${sym.name}${container}${loc}`);
  }
  return lines.join("\n");
}

export function formatCompletion(result: unknown): string {
  if (!result) return "No completions available.";

  let items: CompletionItem[];
  if (Array.isArray(result)) {
    items = result;
  } else {
    items = (result as CompletionResult).items ?? [];
  }

  if (items.length === 0) return "No completions available.";

  const maxItems = 30;
  const shown = items.slice(0, maxItems);
  const lines = [
    `${items.length} completion(s)${items.length > maxItems ? ` (showing first ${maxItems})` : ""}:`,
  ];

  for (const item of shown) {
    const kind = item.kind ? (COMPLETION_KINDS[item.kind] ?? "") : "";
    const detail = item.detail ? ` - ${item.detail}` : "";
    const kindStr = kind ? `[${kind}] ` : "";
    lines.push(`  ${kindStr}${item.label}${detail}`);
  }
  return lines.join("\n");
}

export function formatDiagnostics(diagnostics: unknown[]): string {
  if (diagnostics.length === 0) return "No diagnostics (clean).";

  const diags = diagnostics as Diagnostic[];
  const lines = [`${diags.length} diagnostic(s):`];

  for (const d of diags) {
    const severity = d.severity
      ? (SEVERITY_LABELS[d.severity] ?? "Unknown")
      : "Unknown";
    const source = d.source ? `[${d.source}] ` : "";
    const code = d.code !== undefined ? ` (${d.code})` : "";
    lines.push(
      `  ${severity} at line ${d.range.start.line + 1}:${d.range.start.character + 1}: ${source}${d.message}${code}`,
    );
  }
  return lines.join("\n");
}
