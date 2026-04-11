import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  const configDir = findNearestContainingDir(startDir, "/", [
    "flake.nix",
    "default.nix",
    "shell.nix",
  ]);
  if (configDir) return configDir;
  return startDir;
}

export const fileExtensions = new Set([".nix"]);

export function languageIdForPath(filePath: string): string | null {
  if (filePath.endsWith(".nix")) return "nix";
  return null;
}
