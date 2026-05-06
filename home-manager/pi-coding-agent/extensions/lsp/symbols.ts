import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LspClient } from "./lsp-client";
import { explainLanguageQueryError, languages } from "./languages";
import type { ServerManager } from "./server-manager";
import type {
  DocumentSymbol,
  Location,
  LocationLink,
  Position,
  Range,
  SymbolInformation,
} from "./types";
import { DEFAULT_SKIP_DIRS } from "./workspace-discovery";

export function uriToPath(uri: string): string {
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
    if ((best as SymbolInformation | null)?.name === query) return best;
  }

  return best;
}

export function getLanguageForPath(path: string): string {
  for (const plugin of Object.values(languages)) {
    const id = plugin.languageIdForPath(path);
    if (id) return id;
  }
  return "text";
}

export function findSourceFiles(
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
      if (entry.isDirectory() && !DEFAULT_SKIP_DIRS.has(entry.name)) {
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

async function ensureSourceFallbackDocuments(
  client: LspClient,
  language: string,
  root: string,
  signal?: AbortSignal,
): Promise<void> {
  const exts = languages[language]?.fileExtensions ?? new Set<string>();
  if (client.openDocumentCount() > 0) return;

  for (const file of findSourceFiles(root, exts)) {
    if (signal?.aborted) throw new Error("Aborted");
    await client.ensureDocumentOpen(file);
  }
}

async function routeSymbolMatch(
  manager: ServerManager,
  cwd: string,
  language: string,
  match: SymbolInformation,
): Promise<{ location: Location; client: LspClient } | null> {
  if (!match.location) return null;
  const symbolPath = uriToPath(match.location.uri);
  const { client } = await manager.getClientForFile(cwd, language, symbolPath);
  return { location: match.location, client };
}

export async function resolveSymbolLocation(
  manager: ServerManager,
  cwd: string,
  language: string,
  query: string,
  signal?: AbortSignal,
): Promise<{ location: Location; client: LspClient }> {
  const candidates = await manager.getClientsForQuery(cwd, language);
  let fallbackMatch: { location: Location; client: LspClient } | null = null;
  let queryErrorExplanation: string | null = null;

  for (const { client, instance } of candidates) {
    await ensureSourceFallbackDocuments(
      client,
      language,
      instance.root,
      signal,
    );

    try {
      const symbols = await client.workspaceSymbol(query, signal);
      const match = findBestSymbolMatch(symbols, query);
      if (match?.location) {
        const routed = await routeSymbolMatch(manager, cwd, language, match);
        if (routed) {
          if (match.name === query) return routed;
          fallbackMatch ??= routed;
        }
      }
    } catch (error) {
      queryErrorExplanation ??= explainLanguageQueryError(
        language,
        error,
        query,
        "query lookup",
      );
      // workspace/symbol may fail without project config (e.g. tsserver)
    }
  }

  for (const { client } of candidates) {
    const match = await findSymbolInOpenFiles(client, query);
    if (match?.location) {
      const routed = await routeSymbolMatch(manager, cwd, language, match);
      if (routed) {
        if (match.name === query) return routed;
        fallbackMatch ??= routed;
      }
    }
  }

  if (fallbackMatch) return fallbackMatch;
  if (queryErrorExplanation) throw new Error(queryErrorExplanation);
  throw new Error(`Symbol not found: ${query}`);
}

export async function formatDefinitionWithImplementation(
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
    if (bodyRange && text) {
      sections.push(
        `${path}:${bodyRange.start.line + 1}\n\n\`\`\`${getLanguageForPath(path)}\n${text}\n\`\`\``,
      );
    } else {
      sections.push(`${path}:${selectionPos.line + 1}`);
    }
  }

  return sections.join("\n\n");
}
