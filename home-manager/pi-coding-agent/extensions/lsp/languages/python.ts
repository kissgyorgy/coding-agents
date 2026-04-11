import { pathToFileURL } from "node:url";
import type { LspServerConfig } from "../lsp-client";

export const languageId = "python";

export function getConfig(cwd: string): LspServerConfig[] {
  return [
    {
      command: "nix-shell",
      args: ["-p", "basedpyright", "--run", "basedpyright-langserver --stdio"],
      rootUri: pathToFileURL(cwd).href,
      settings: {
        basedpyright: {
          analysis: {
            diagnosticMode: "openFilesOnly",
          },
        },
      },
    },
  ];
}

export function getWorkspaceRoot(
  startDir: string,
  _ctx: { cwd: string },
): string {
  return startDir;
}

export const fileExtensions = new Set([".py", ".pyi"]);

export function languageIdForPath(filePath: string): string | null {
  if (filePath.endsWith(".py") || filePath.endsWith(".pyi")) return "python";
  return null;
}

export function createIndexingTracker() {
  let done = false;
  return {
    handleMessage(msg: { method?: string; params?: unknown }) {
      if (msg.method === "window/logMessage") {
        const params = msg.params as { message: string };
        if (/Found \d+ source files/.test(params.message)) done = true;
      }
    },
    isDone: () => done,
  };
}
