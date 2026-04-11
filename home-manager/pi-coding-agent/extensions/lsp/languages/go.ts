import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LspServerConfig } from "../lsp-client";

export const languageId = "go";

export function getConfig(cwd: string): LspServerConfig[] {
  return [
    {
      command: "gopls",
      args: ["serve"],
      rootUri: pathToFileURL(cwd).href,
    },
  ];
}

function findNearestContainingDir(
  startDir: string,
  stopDir: string,
  fileNames: string[],
): string | null {
  let current = resolve(startDir);
  const limit = resolve(stopDir);

  while (true) {
    for (const fileName of fileNames) {
      if (existsSync(join(current, fileName))) return current;
    }
    if (current === limit) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    if (!current.startsWith(limit)) return null;
    current = parent;
  }
}

export function getWorkspaceRoot(
  startDir: string,
  _ctx: { cwd: string },
): string {
  return findNearestContainingDir(startDir, "/", ["go.mod"]) ?? startDir;
}

export const fileExtensions = new Set([".go"]);

export function languageIdForPath(filePath: string): string | null {
  if (filePath.endsWith(".go")) return "go";
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
    isDone: () => !started || tokens.size === 0,
  };
}
