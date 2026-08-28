import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { isPathInsideOrSame } from "./languages/utils";

const execFileAsync = promisify(execFile);

async function findGitRoot(directory: string): Promise<string | null> {
  try {
    const result = await execFileAsync(
      "git",
      ["-C", directory, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    );
    const root = String(result.stdout).trim();
    return root ? resolve(root) : null;
  } catch {
    return null;
  }
}

function findIgnoredPaths(
  gitRoot: string,
  filePaths: string[],
): Promise<Set<string>> {
  if (filePaths.length === 0) return Promise.resolve(new Set());

  return new Promise((resolveResult) => {
    const child = spawn(
      "git",
      ["-C", gitRoot, "check-ignore", "--no-index", "-z", "--stdin"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (paths: Set<string>): void => {
      if (settled) return;
      settled = true;
      resolveResult(paths);
    };

    child.on("error", () => finish(new Set()));
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        finish(new Set());
        return;
      }

      const ignored = new Set(
        Buffer.concat(chunks)
          .toString("utf8")
          .split("\0")
          .filter(Boolean)
          .map((path) => resolve(path)),
      );
      finish(ignored);
    });

    child.stdin.end(Buffer.from(`${filePaths.join("\0")}\0`));
  });
}

/** Filters paths through Git's standard ignore sources for known worktrees. */
export class GitIgnoreFilter {
  private gitRoots = new Set<string>();

  async addDirectory(directory: string): Promise<void> {
    const gitRoot = await findGitRoot(resolve(directory));
    if (gitRoot) this.gitRoots.add(gitRoot);
  }

  async excludeIgnored(filePaths: string[]): Promise<string[]> {
    const paths = [...new Set(filePaths.map((path) => resolve(path)))];
    const roots = [...this.gitRoots].sort((a, b) => b.length - a.length);
    const pathsByRoot = new Map<string, string[]>();

    for (const path of paths) {
      const root = roots.find((candidate) =>
        isPathInsideOrSame(path, candidate),
      );
      if (!root) continue;
      const grouped = pathsByRoot.get(root) ?? [];
      grouped.push(path);
      pathsByRoot.set(root, grouped);
    }

    const ignored = new Set<string>();
    await Promise.all(
      [...pathsByRoot].map(async ([root, groupedPaths]) => {
        for (const path of await findIgnoredPaths(root, groupedPaths)) {
          ignored.add(path);
        }
      }),
    );

    return paths.filter((path) => !ignored.has(path));
  }
}
