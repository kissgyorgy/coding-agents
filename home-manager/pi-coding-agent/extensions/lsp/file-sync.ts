import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ServerManager } from "./server-manager";
import {
  DEFAULT_SKIP_DIRS,
  normalizeToolPath,
  type WorkspaceInstance,
} from "./workspace-discovery";
import { isPathInsideOrSame } from "./languages/utils";

type ToolResultEventLike = {
  toolName: string;
  input: unknown;
  isError?: boolean;
};

type FileSyncOptions = {
  debounceMs?: number;
  maxWatchers?: number;
  maxDepth?: number;
  skipDirs?: Set<string>;
};

export class FileSync {
  private watchers = new Map<string, FSWatcher>();
  private pendingRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingDirectoryChecks = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private debounceMs: number;
  private maxWatchers: number;
  private maxDepth: number;
  private skipDirs: Set<string>;

  constructor(
    private manager: ServerManager,
    options: FileSyncOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 150;
    this.maxWatchers = options.maxWatchers ?? 1000;
    this.maxDepth = options.maxDepth ?? 16;
    this.skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  }

  start(instances: WorkspaceInstance[]): void {
    this.stopWatchers();
    this.clearPendingRefreshes();
    this.clearPendingDirectoryChecks();
    for (const root of this.minimalRoots(instances)) {
      this.watchDirectoryRecursive(root, 0, true);
    }
  }

  stop(): void {
    this.stopWatchers();
    this.clearPendingRefreshes();
    this.clearPendingDirectoryChecks();
  }

  handleToolResult(event: ToolResultEventLike, cwd: string): void {
    if (event.isError) return;
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const input = event.input as { path?: unknown } | null;
    if (!input || typeof input.path !== "string") return;

    const absolutePath = normalizeToolPath(cwd, input.path);
    void this.manager.refreshChangedPath(absolutePath).catch(() => {});
  }

  notifyChangedPath(path: string): void {
    this.queueRefresh(resolve(path));
  }

  private minimalRoots(instances: WorkspaceInstance[]): string[] {
    const roots = [
      ...new Set(instances.map((instance) => resolve(instance.root))),
    ].sort((a, b) => a.length - b.length);
    const selected: string[] = [];
    for (const root of roots) {
      if (selected.some((existing) => isPathInsideOrSame(root, existing))) {
        continue;
      }
      selected.push(root);
    }
    return selected;
  }

  private watchDirectoryRecursive(
    directory: string,
    depth: number,
    isRoot = false,
  ): void {
    const root = resolve(directory);
    if (this.watchers.has(root)) return;
    if (!isRoot && this.skipDirs.has(basename(root))) return;
    if (depth > this.maxDepth) return;
    if (this.watchers.size >= this.maxWatchers) return;

    let stat;
    try {
      stat = statSync(root);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;

    try {
      const watcher = watch(root, (eventType, fileName) => {
        const changedPath = fileName
          ? resolve(root, fileName.toString())
          : root;
        this.queueRefresh(changedPath);
        if (eventType === "rename")
          this.queueDirectoryCheck(changedPath, depth + 1);
      });
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(root);
      });
      this.watchers.set(root, watcher);
    } catch {
      return;
    }

    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (this.skipDirs.has(entry.name)) continue;
      this.watchDirectoryRecursive(join(root, entry.name), depth + 1);
    }
  }

  private queueRefresh(path: string): void {
    const absolutePath = resolve(path);
    const existing = this.pendingRefreshes.get(absolutePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingRefreshes.delete(absolutePath);
      void this.manager.refreshChangedPath(absolutePath).catch(() => {});
    }, this.debounceMs);
    this.pendingRefreshes.set(absolutePath, timer);
  }

  private queueDirectoryCheck(path: string, depth: number): void {
    const absolutePath = resolve(path);
    const existing = this.pendingDirectoryChecks.get(absolutePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingDirectoryChecks.delete(absolutePath);
      this.watchDirectoryRecursive(absolutePath, depth);
    }, this.debounceMs);
    this.pendingDirectoryChecks.set(absolutePath, timer);
  }

  private stopWatchers(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }

  private clearPendingRefreshes(): void {
    for (const timer of this.pendingRefreshes.values()) {
      clearTimeout(timer);
    }
    this.pendingRefreshes.clear();
  }

  private clearPendingDirectoryChecks(): void {
    for (const timer of this.pendingDirectoryChecks.values()) {
      clearTimeout(timer);
    }
    this.pendingDirectoryChecks.clear();
  }
}
