import { pathToFileURL } from "node:url";
import type { LspServerConfig } from "../lsp-client";
import { getWorkspaceRootFromMarkers } from "./utils";

export const languageId = "typescript";
export const workspaceMarkers = [
  "tsconfig.json",
  "jsconfig.json",
  "package.json",
];

export function getConfig(cwd: string): LspServerConfig[] {
  return [
    {
      command: "typescript-language-server",
      args: ["--stdio"],
      rootUri: pathToFileURL(cwd).href,
    },
  ];
}

export function getWorkspaceRoot(
  startDir: string,
  ctx: { cwd: string },
): string {
  return getWorkspaceRootFromMarkers(startDir, ctx, workspaceMarkers);
}

export const fileExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
]);

export function isNoProjectError(error: unknown): boolean {
  return String(error).includes("No Project");
}

export function formatNoProjectExplanation(
  query: string,
  operation: "workspace_symbol" | "query lookup",
): string {
  return [
    `TypeScript ${operation} could not search for ${JSON.stringify(query)} because tsserver has no project loaded yet.`,
    "This usually happens when a TypeScript LSP server was started for a workspace root, but no .ts/.tsx file from that workspace has been opened, so tsserver has not attached a tsconfig/jsconfig project.",
    `Try document_symbols on a source file inside the target TypeScript workspace, then retry ${operation}. If you know the file, prefer file+position definition/references.`,
  ].join("\n");
}

export function explainQueryError(
  error: unknown,
  query: string,
  operation: "workspace_symbol" | "query lookup",
): string | null {
  if (!isNoProjectError(error)) return null;
  return formatNoProjectExplanation(query, operation);
}

export function languageIdForPath(filePath: string): string | null {
  if (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".mts") ||
    filePath.endsWith(".cts")
  )
    return "typescript";
  if (filePath.endsWith(".tsx")) return "typescriptreact";
  if (
    filePath.endsWith(".js") ||
    filePath.endsWith(".mjs") ||
    filePath.endsWith(".cjs")
  )
    return "javascript";
  if (filePath.endsWith(".jsx")) return "javascriptreact";
  return null;
}

export function createIndexingTracker() {
  const tokens = new Set<string | number>();
  let started = false;
  return {
    handleMessage(msg: { method?: string; params?: unknown }) {
      if (msg.method === "$/progress") {
        const params = msg.params as {
          token: string | number;
          value: { kind: string };
        };
        if (params.value.kind === "begin") {
          tokens.add(params.token);
          started = true;
        } else if (params.value.kind === "end") {
          tokens.delete(params.token);
        }
      }
    },
    isDone: () => started && tokens.size === 0,
  };
}
