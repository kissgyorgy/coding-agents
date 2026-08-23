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
