import { pathToFileURL } from "node:url";
import type { LspServerConfig } from "../lsp-client";
import { getWorkspaceRootFromMarkers } from "./utils";

export const languageId = "nix";
export const workspaceMarkers = ["flake.nix", "shell.nix", "devenv.nix"];

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
  ctx: { cwd: string },
): string {
  return getWorkspaceRootFromMarkers(startDir, ctx, workspaceMarkers);
}

export const fileExtensions = new Set([".nix"]);

export function languageIdForPath(filePath: string): string | null {
  if (filePath.endsWith(".nix")) return "nix";
  return null;
}
