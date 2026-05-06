import type { LspServerConfig } from "../lsp-client";

export interface IndexingTracker {
  handleMessage(msg: { method?: string; params?: unknown }): void;
  isDone(): boolean;
}

export interface LanguagePlugin {
  languageId: string;
  getConfig: (cwd: string) => LspServerConfig[];
  getWorkspaceRoot: (startDir: string, ctx: { cwd: string }) => string;
  fileExtensions: Set<string>;
  workspaceMarkers: string[];
  languageIdForPath: (filePath: string) => string | null;
  createIndexingTracker?: () => IndexingTracker;
}
