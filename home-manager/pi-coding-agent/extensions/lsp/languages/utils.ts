import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export function isPathInsideOrSame(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function findNearestContainingDir(
  startDir: string,
  stopDir: string,
  fileNames: string[],
): string | null {
  let current = resolve(startDir);
  const limit = resolve(stopDir);

  if (!isPathInsideOrSame(current, limit)) return null;

  while (true) {
    for (const fileName of fileNames) {
      if (existsSync(join(current, fileName))) return current;
    }
    if (current === limit) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    if (!isPathInsideOrSame(parent, limit)) return null;
    current = parent;
  }
}

export function getWorkspaceRootFromMarkers(
  startDir: string,
  ctx: { cwd: string },
  fileNames: string[],
): string {
  const resolvedStart = resolve(startDir);
  const resolvedCwd = resolve(ctx.cwd);
  const stopDir = isPathInsideOrSame(resolvedStart, resolvedCwd)
    ? resolvedCwd
    : resolvedStart;

  return (
    findNearestContainingDir(resolvedStart, stopDir, fileNames) ?? resolvedStart
  );
}
