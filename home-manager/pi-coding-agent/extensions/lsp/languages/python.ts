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
