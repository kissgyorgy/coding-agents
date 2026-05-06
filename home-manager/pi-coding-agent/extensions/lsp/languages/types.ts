import type { LspServerConfig } from "../lsp-client";

export interface IndexingTracker {
  handleMessage(msg: { method?: string; params?: unknown }): void;
  isDone(): boolean;
}

export type QueryOperation = "workspace_symbol" | "query lookup";

export interface LanguagePlugin {
  languageId: string;
  getConfig: (cwd: string) => LspServerConfig[];
  getWorkspaceRoot: (startDir: string, ctx: { cwd: string }) => string;
  fileExtensions: Set<string>;
  workspaceMarkers: string[];
  languageIdForPath: (filePath: string) => string | null;
  explainQueryError?: (
    error: unknown,
    query: string,
    operation: QueryOperation,
  ) => string | null;
  createIndexingTracker?: () => IndexingTracker;
}
