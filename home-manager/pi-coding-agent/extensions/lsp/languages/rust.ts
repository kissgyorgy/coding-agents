import { pathToFileURL } from "node:url";
import type { LspServerConfig } from "../lsp-client";
import { getWorkspaceRootFromMarkers } from "./utils";

export const languageId = "rust";
export const workspaceMarkers = ["Cargo.toml", "rust-project.json"];

export function getConfig(cwd: string): LspServerConfig[] {
  return [
    {
      command: "rust-analyzer",
      args: [],
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

export const fileExtensions = new Set([".rs"]);

export function languageIdForPath(filePath: string): string | null {
  if (filePath.endsWith(".rs")) return "rust";
  return null;
}
