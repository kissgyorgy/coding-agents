import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  "vendor",
  "target",
  ".next",
  ".cache",
  "coverage",
]);

type DiscoveryOptions = {
  skipDirs?: Set<string>;
  maxDirectories?: number;
  maxInstances?: number;
  maxDepth?: number;
};

type LanguagePlugins = Record<string, LanguagePlugin>;

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
