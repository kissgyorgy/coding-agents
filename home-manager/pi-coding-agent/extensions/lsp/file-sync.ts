import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ServerManager } from "./server-manager";
import { FILE_CHANGE_TYPE, type FileChangeType } from "./types";
import {
  DEFAULT_SKIP_DIRS,
  normalizeToolPath,
  type WorkspaceInstance,
} from "./workspace-discovery";
import { isPathInsideOrSame } from "./languages/utils";

type ToolExecutionStartEventLike = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

type ToolExecutionEndEventLike = {
  toolCallId: string;
  toolName: string;
  isError: boolean;
};

type ToolMutationState = {
  filePath: string;
  existed: boolean;
};

type FileSyncOptions = {
  debounceMs?: number;
  maxQuietWaitMs?: number;
  maxWatchers?: number;
  maxDepth?: number;
  skipDirs?: Set<string>;
};

export class FileSync {
  private watchers = new Map<string, FSWatcher>();
  private pendingRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
  private activeRefreshes = new Set<Promise<void>>();
  private pendingDirectoryChecks = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private knownFiles = new Set<string>();
  private toolMutationStates = new Map<string, ToolMutationState>();
  private changedPaths = new Set<string>();
  private collectingChanges = false;
  private changeGeneration = 0;
  private debounceMs: number;
  private maxQuietWaitMs: number;
  private maxWatchers: number;
  private maxDepth: number;
  private skipDirs: Set<string>;

  constructor(
    private manager: ServerManager,
    options: FileSyncOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 150;
    this.maxQuietWaitMs = options.maxQuietWaitMs ?? 2000;
    this.maxWatchers = options.maxWatchers ?? 1000;
    this.maxDepth = options.maxDepth ?? 16;
    this.skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  }

  start(instances: WorkspaceInstance[]): void {
    this.stopWatchers();
    this.clearPendingRefreshes();
    this.clearPendingDirectoryChecks();
    this.knownFiles.clear();
    for (const root of this.minimalRoots(instances)) {
      this.watchDirectoryRecursive(root, 0, true);
    }
  }

  stop(): void {
    this.stopWatchers();
    this.clearPendingRefreshes();
    this.clearPendingDirectoryChecks();
    this.activeRefreshes.clear();
    this.knownFiles.clear();
    this.toolMutationStates.clear();
    this.collectingChanges = false;
    this.changedPaths.clear();
  }

  beginAgentRun(): void {
    if (this.collectingChanges) return;
    this.collectingChanges = true;
    this.changedPaths.clear();
    this.toolMutationStates.clear();
    this.changeGeneration++;
  }

  async takeChangedPathsAfterQuiet(): Promise<string[]> {
    if (!this.collectingChanges) return [];

    const deadline = Date.now() + this.maxQuietWaitMs;
    while (Date.now() < deadline) {
      const generation = this.changeGeneration;
      await new Promise((resolve) => setTimeout(resolve, this.debounceMs));
      if (
        generation === this.changeGeneration &&
        this.pendingRefreshes.size === 0 &&
        this.activeRefreshes.size === 0 &&
        this.pendingDirectoryChecks.size === 0
      )
        break;
    }

    this.collectingChanges = false;
    const paths = [...this.changedPaths].sort();
    this.changedPaths.clear();
    return paths;
  }

  handleToolExecutionStart(
    event: ToolExecutionStartEventLike,
    cwd: string,
  ): void {
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const args = event.args as { path?: unknown } | null;
    if (!args || typeof args.path !== "string") return;

    const filePath = normalizeToolPath(cwd, args.path);
    // Once write finishes, filesystem state alone cannot distinguish creation
    // from replacement. Capture it before the tool mutates the path.
    this.toolMutationStates.set(event.toolCallId, {
      filePath,
      existed: this.isRegularFile(filePath),
    });
  }

  async handleToolExecutionEnd(
    event: ToolExecutionEndEventLike,
    cwd: string,
  ): Promise<void> {
    const mutation = this.toolMutationStates.get(event.toolCallId);
    this.toolMutationStates.delete(event.toolCallId);

    if (event.isError) return;
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    if (!mutation) return;

    const absolutePath = mutation.filePath;
    const existed = mutation.existed;
    const exists = this.isRegularFile(absolutePath);
    let changeType: FileChangeType;
    if (exists) {
      changeType = existed
        ? FILE_CHANGE_TYPE.Changed
        : FILE_CHANGE_TYPE.Created;
      this.knownFiles.add(absolutePath);
    } else if (existed) {
      changeType = FILE_CHANGE_TYPE.Deleted;
      this.knownFiles.delete(absolutePath);
    } else {
      return;
    }

    this.recordChangedPath(absolutePath);
    await this.manager
      .refreshFile(cwd, absolutePath, changeType)
      .catch(() => {});
  }

  notifyChangedPath(path: string): void {
    const absolutePath = resolve(path);
    this.recordChangedPath(absolutePath);
    this.queueRefresh(absolutePath);
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
    recordExistingFiles = false,
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
        this.recordChangedPath(changedPath);
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
      const entryPath = join(root, entry.name);
      if (entry.isFile()) {
        const absolutePath = resolve(entryPath);
        const wasKnown = this.knownFiles.has(absolutePath);
        this.knownFiles.add(absolutePath);
        if (recordExistingFiles) {
          this.recordChangedPath(absolutePath);
          this.queueRefresh(
            absolutePath,
            wasKnown ? FILE_CHANGE_TYPE.Changed : FILE_CHANGE_TYPE.Created,
          );
        }
      }
      if (!entry.isDirectory()) continue;
      if (this.skipDirs.has(entry.name)) continue;
      this.watchDirectoryRecursive(
        entryPath,
        depth + 1,
        false,
        recordExistingFiles,
      );
    }
  }

  private isRegularFile(path: string): boolean {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }

  private detectFileChange(path: string): FileChangeType | undefined {
    const absolutePath = resolve(path);
    const wasKnown = this.knownFiles.has(absolutePath);
    if (this.isRegularFile(absolutePath)) {
      this.knownFiles.add(absolutePath);
      return wasKnown ? FILE_CHANGE_TYPE.Changed : FILE_CHANGE_TYPE.Created;
    }
    if (!wasKnown) return undefined;

    this.knownFiles.delete(absolutePath);
    return FILE_CHANGE_TYPE.Deleted;
  }

  private recordChangedPath(path: string): void {
    if (!this.collectingChanges) return;
    this.changedPaths.add(resolve(path));
    this.changeGeneration++;
  }

  private queueRefresh(path: string, changeType?: FileChangeType): void {
    const absolutePath = resolve(path);
    const existing = this.pendingRefreshes.get(absolutePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingRefreshes.delete(absolutePath);
      const detectedChange = changeType ?? this.detectFileChange(absolutePath);
      if (detectedChange === undefined) return;
      this.trackRefresh(
        this.manager.refreshChangedPath(absolutePath, detectedChange),
      );
    }, this.debounceMs);
    this.pendingRefreshes.set(absolutePath, timer);
  }

  private trackRefresh(refresh: Promise<void>): void {
    let tracked: Promise<void>;
    tracked = refresh
      .catch(() => {})
      .finally(() => this.activeRefreshes.delete(tracked));
    this.activeRefreshes.add(tracked);
  }

  private queueDirectoryCheck(path: string, depth: number): void {
    const absolutePath = resolve(path);
    const existing = this.pendingDirectoryChecks.get(absolutePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingDirectoryChecks.delete(absolutePath);
      this.watchDirectoryRecursive(absolutePath, depth, false, true);
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
