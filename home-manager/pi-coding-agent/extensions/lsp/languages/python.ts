import { pathToFileURL } from "node:url";
import type { LspServerConfig } from "../lsp-client";
import { getWorkspaceRootFromMarkers } from "./utils";

export const languageId = "python";
export const workspaceMarkers = [
  "pyproject.toml",
  "setup.cfg",
  "setup.py",
  "requirements.txt",
];

export function getConfig(cwd: string): LspServerConfig[] {
  const rootUri = pathToFileURL(cwd).href;
  const settings = {
    basedpyright: {
      analysis: {
        diagnosticMode: "openFilesOnly",
      },
    },
  };

  return [
    {
      command: "basedpyright-langserver",
      args: ["--stdio"],
      rootUri,
      settings,
    },
  ];
}

export function getWorkspaceRoot(
  startDir: string,
  ctx: { cwd: string },
): string {
  return getWorkspaceRootFromMarkers(startDir, ctx, workspaceMarkers);
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
