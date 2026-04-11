import { pathToFileURL } from "node:url";
import type { LspServerConfig } from "../lsp-client";

export const languageId = "nix";

export function getConfig(cwd: string): LspServerConfig[] {
  return [
    {
      command: "nil",
      args: ["--stdio"],
      rootUri: pathToFileURL(cwd).href,
    },
  ];
}

export function getWorkspaceRoot(
  startDir: string,
  _ctx: { cwd: string },
): string {
  return startDir;
}

export const fileExtensions = new Set([".nix"]);

export function languageIdForPath(filePath: string): string | null {
  if (filePath.endsWith(".nix")) return "nix";
  return null;
}
