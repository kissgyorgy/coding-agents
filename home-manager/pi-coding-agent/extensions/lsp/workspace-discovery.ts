import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { languages, type LanguagePlugin } from "./languages";
import { isPathInsideOrSame } from "./languages/utils";

export type WorkspaceInstance = {
  language: string;
  root: string;
  marker: string;
};

export const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".nix",
  ".direnv",
  ".devenv",
  ".uv_cache",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "vendor",
  "target",
  ".next",
  ".cache",
  ".yarn",
  ".pnpm-store",
  "coverage",
  "claudetmp",
]);

type DiscoveryOptions = {
  skipDirs?: Set<string>;
  maxDirectories?: number;
  maxInstances?: number;
  maxDepth?: number;
  respectGitIgnore?: boolean;
};

type LanguagePlugins = Record<string, LanguagePlugin>;

const execFileAsync = promisify(execFile);

export function normalizeToolPath(cwd: string, filePath: string): string {
  const normalized = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  return resolve(cwd, normalized);
}

export function acceptsFilePath(
  plugin: LanguagePlugin,
  filePath: string,
): boolean {
  return plugin.languageIdForPath(filePath) !== null;
}

export function findWorkspaceMarker(
  root: string,
  markerNames: string[],
): string | null {
  for (const marker of markerNames) {
    if (existsSync(join(root, marker))) return marker;
  }
  return null;
}

function addInstance(
  instances: WorkspaceInstance[],
  seen: Set<string>,
  language: string,
  root: string,
  marker: string,
  maxInstances: number,
): void {
  if (instances.length >= maxInstances) return;
  const normalizedRoot = resolve(root);
  const key = `${language}\0${normalizedRoot}`;
  if (seen.has(key)) return;
  seen.add(key);
  instances.push({ language, root: normalizedRoot, marker });
}

async function getGitRoot(root: string): Promise<string | null> {
  try {
    const result = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    );
    const gitRoot = String(result.stdout).trim();
    return gitRoot ? resolve(gitRoot) : null;
  } catch {
    return null;
  }
}

function hasSkippedSegment(
  path: string,
  root: string,
  skipDirs: Set<string>,
): boolean {
  return relative(root, path)
    .split(/[\\/]+/)
    .some((segment) => skipDirs.has(segment));
}

async function discoverGitWorkspaceInstances(
  root: string,
  gitRoot: string,
  plugins: LanguagePlugins,
  options: Required<Pick<DiscoveryOptions, "skipDirs" | "maxInstances">>,
): Promise<WorkspaceInstance[]> {
  const relativeRoot = relative(gitRoot, root);
  const pathspec = relativeRoot === "" ? "." : relativeRoot;

  let stdout: string;
  try {
    const result = await execFileAsync(
      "git",
      [
        "-C",
        gitRoot,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        pathspec,
      ],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    stdout = String(result.stdout);
  } catch {
    return [];
  }

  const markerEntries: Array<{
    language: string;
    root: string;
    marker: string;
    markerIndex: number;
  }> = [];

  for (const relPath of stdout.split("\0")) {
    if (!relPath) continue;
    const absPath = resolve(gitRoot, relPath);
    if (hasSkippedSegment(absPath, root, options.skipDirs)) continue;
    const markerRoot = dirname(absPath);

    for (const [language, plugin] of Object.entries(plugins)) {
      const markerIndex = plugin.workspaceMarkers.findIndex((marker) =>
        absPath.endsWith(`/${marker}`),
      );
      if (markerIndex === -1) continue;
      markerEntries.push({
        language,
        root: markerRoot,
        marker: plugin.workspaceMarkers[markerIndex],
        markerIndex,
      });
    }
  }

  markerEntries.sort(
    (a, b) =>
      a.language.localeCompare(b.language) ||
      a.root.localeCompare(b.root) ||
      a.markerIndex - b.markerIndex,
  );

  const instances: WorkspaceInstance[] = [];
  const seen = new Set<string>();
  for (const entry of markerEntries) {
    addInstance(
      instances,
      seen,
      entry.language,
      entry.root,
      entry.marker,
      options.maxInstances,
    );
  }
  return instances;
}

export function discoverWorkspaceInstances(
  cwd: string,
  plugins: LanguagePlugins = languages,
  options: DiscoveryOptions = {},
): WorkspaceInstance[] {
  const root = resolve(cwd);
  const instances: WorkspaceInstance[] = [];
  const seen = new Set<string>();
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const maxDirectories = options.maxDirectories ?? 5000;
  const maxInstances = options.maxInstances ?? 200;
  const maxDepth = options.maxDepth ?? 12;
  let visitedDirectories = 0;

  const scan = (dir: string, depth: number): void => {
    if (
      visitedDirectories >= maxDirectories ||
      instances.length >= maxInstances ||
      depth > maxDepth
    ) {
      return;
    }

    visitedDirectories++;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const files = new Set(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );

    for (const [language, plugin] of Object.entries(plugins)) {
      const marker = plugin.workspaceMarkers.find((name) => files.has(name));
      if (marker)
        addInstance(instances, seen, language, dir, marker, maxInstances);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skipDirs.has(entry.name)) continue;
      scan(join(dir, entry.name), depth + 1);
    }
  };

  scan(root, 0);
  instances.sort(
    (a, b) =>
      a.language.localeCompare(b.language) ||
      a.root.localeCompare(b.root) ||
      a.marker.localeCompare(b.marker),
  );
  return instances;
}

async function discoverWorkspaceInstancesByScan(
  cwd: string,
  plugins: LanguagePlugins,
  options: Required<
    Pick<
      DiscoveryOptions,
      "skipDirs" | "maxDirectories" | "maxInstances" | "maxDepth"
    >
  >,
): Promise<WorkspaceInstance[]> {
  const root = resolve(cwd);
  const instances: WorkspaceInstance[] = [];
  const seen = new Set<string>();
  let visitedDirectories = 0;

  const scan = async (dir: string, depth: number): Promise<void> => {
    if (
      visitedDirectories >= options.maxDirectories ||
      instances.length >= options.maxInstances ||
      depth > options.maxDepth
    ) {
      return;
    }

    visitedDirectories++;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const files = new Set(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );

    for (const [language, plugin] of Object.entries(plugins)) {
      const marker = plugin.workspaceMarkers.find((name) => files.has(name));
      if (marker) {
        addInstance(
          instances,
          seen,
          language,
          dir,
          marker,
          options.maxInstances,
        );
      }
    }

    await new Promise((resolve) => setImmediate(resolve));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (options.skipDirs.has(entry.name)) continue;
      await scan(join(dir, entry.name), depth + 1);
    }
  };

  await scan(root, 0);
  instances.sort(
    (a, b) =>
      a.language.localeCompare(b.language) ||
      a.root.localeCompare(b.root) ||
      a.marker.localeCompare(b.marker),
  );
  return instances;
}

export async function discoverWorkspaceInstancesAsync(
  cwd: string,
  plugins: LanguagePlugins = languages,
  options: DiscoveryOptions = {},
): Promise<WorkspaceInstance[]> {
  const root = resolve(cwd);
  const normalizedOptions = {
    skipDirs: options.skipDirs ?? DEFAULT_SKIP_DIRS,
    maxDirectories: options.maxDirectories ?? 5000,
    maxInstances: options.maxInstances ?? 200,
    maxDepth: options.maxDepth ?? 12,
  };

  if (options.respectGitIgnore !== false) {
    const gitRoot = await getGitRoot(root);
    if (gitRoot) {
      const gitInstances = await discoverGitWorkspaceInstances(
        root,
        gitRoot,
        plugins,
        normalizedOptions,
      );
      return gitInstances;
    }
  }

  return discoverWorkspaceInstancesByScan(root, plugins, normalizedOptions);
}

function nearestContainingInstance(
  instances: WorkspaceInstance[],
  language: string,
  filePath: string,
): WorkspaceInstance | null {
  const candidates = instances
    .filter(
      (instance) =>
        instance.language === language &&
        isPathInsideOrSame(filePath, instance.root),
    )
    .sort((a, b) => b.root.length - a.root.length);
  return candidates[0] ?? null;
}

export function fallbackWorkspaceInstanceForFile(
  cwd: string,
  language: string,
  filePath: string,
  plugins: LanguagePlugins = languages,
): WorkspaceInstance | null {
  const plugin = plugins[language];
  if (!plugin) return null;
  if (!acceptsFilePath(plugin, filePath)) return null;

  const startDir = dirname(filePath);
  const root = plugin.getWorkspaceRoot(startDir, { cwd });
  const marker = findWorkspaceMarker(root, plugin.workspaceMarkers);
  if (!marker) return null;
  return { language, root, marker };
}

export function selectWorkspaceForFile(
  instances: WorkspaceInstance[],
  cwd: string,
  language: string,
  filePath: string,
  plugins: LanguagePlugins = languages,
): WorkspaceInstance | null {
  const plugin = plugins[language];
  if (!plugin) return null;
  const absolutePath = resolve(
    cwd,
    filePath.startsWith("@") ? filePath.slice(1) : filePath,
  );
  if (!acceptsFilePath(plugin, absolutePath)) return null;

  return (
    nearestContainingInstance(instances, language, absolutePath) ??
    fallbackWorkspaceInstanceForFile(cwd, language, absolutePath, plugins)
  );
}

export function selectWorkspaceInstancesForQuery(
  instances: WorkspaceInstance[],
  cwd: string,
  language: string,
  plugins: LanguagePlugins = languages,
): WorkspaceInstance[] {
  const plugin = plugins[language];
  if (!plugin) return [];

  const selected = instances.filter(
    (instance) => instance.language === language,
  );
  if (selected.length > 0) return selected;

  const root = plugin.getWorkspaceRoot(cwd, { cwd });
  const marker = findWorkspaceMarker(root, plugin.workspaceMarkers);
  return marker ? [{ language, root, marker }] : [];
}

export function workspaceKey(language: string, root: string): string {
  return `${language}:${resolve(root)}`;
}
