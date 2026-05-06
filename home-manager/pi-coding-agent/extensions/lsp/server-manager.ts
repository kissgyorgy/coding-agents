import { resolve } from "node:path";
import { invalidateFilePreviewCache } from "./formatters";
import { LspClient } from "./lsp-client";
import { languages, type LanguagePlugin } from "./languages";
import { isPathInsideOrSame } from "./languages/utils";
import {
  acceptsFilePath,
  selectWorkspaceForFile,
  selectWorkspaceInstancesForQuery,
  workspaceKey,
  type WorkspaceInstance,
} from "./workspace-discovery";

export type ServerState =
  | "discovered"
  | "starting"
  | "running"
  | "failed"
  | "stopped";

export type ServerStatus = WorkspaceInstance & {
  key: string;
  state: ServerState;
  error?: string;
};

type ServerEntry = {
  key: string;
  instance: WorkspaceInstance;
  state: ServerState;
  client?: LspClient;
  startPromise?: Promise<LspClient>;
  error?: Error;
};

type LanguagePlugins = Record<string, LanguagePlugin>;

export class ServerManager {
  private entries = new Map<string, ServerEntry>();
  private discoveredInstances: WorkspaceInstance[] = [];

  constructor(private plugins: LanguagePlugins = languages) {}

  setDiscoveredInstances(instances: WorkspaceInstance[]): void {
    this.discoveredInstances = [...instances];
    for (const instance of instances) {
      this.ensureEntry(instance);
    }
  }

  getDiscoveredInstances(): WorkspaceInstance[] {
    return [...this.discoveredInstances];
  }

  startAllInBackground(instances: WorkspaceInstance[]): void {
    this.setDiscoveredInstances(instances);
    for (const instance of instances) {
      this.startInBackground(instance);
    }
  }

  startInBackground(instance: WorkspaceInstance): void {
    const entry = this.ensureEntry(instance);
    if (entry.state === "running" || entry.state === "starting") return;
    this.startEntry(entry);
  }

  async getClientForFile(
    cwd: string,
    language: string,
    filePath: string,
  ): Promise<{ client: LspClient; instance: WorkspaceInstance }> {
    const plugin = this.plugins[language];
    if (!plugin) throw new Error(`Unsupported language: ${language}`);

    const absolutePath = resolve(
      cwd,
      filePath.startsWith("@") ? filePath.slice(1) : filePath,
    );
    if (!acceptsFilePath(plugin, absolutePath)) {
      throw new Error(
        `${filePath} is not supported by the ${language} LSP plugin`,
      );
    }

    const instance = selectWorkspaceForFile(
      this.discoveredInstances,
      cwd,
      language,
      absolutePath,
      this.plugins,
    );

    if (!instance) {
      throw new Error(
        `No ${language} workspace found for ${filePath}. Add a workspace marker and run /reload.`,
      );
    }

    const client = await this.getClient(instance);
    return { client, instance };
  }

  async getClientsForQuery(
    cwd: string,
    language: string,
  ): Promise<Array<{ client: LspClient; instance: WorkspaceInstance }>> {
    const plugin = this.plugins[language];
    if (!plugin) throw new Error(`Unsupported language: ${language}`);

    const instances = selectWorkspaceInstancesForQuery(
      this.discoveredInstances,
      cwd,
      language,
      this.plugins,
    );

    if (instances.length === 0) {
      throw new Error(
        `No ${language} workspaces discovered. Add a workspace marker and run /reload.`,
      );
    }

    const settled = await Promise.allSettled(
      instances.map(async (instance) => ({
        client: await this.getClient(instance),
        instance,
      })),
    );
    const clients = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    if (clients.length === 0) {
      const errors = settled
        .flatMap((result) =>
          result.status === "rejected" ? [String(result.reason)] : [],
        )
        .join("; ");
      throw new Error(
        `No ${language} LSP servers are available${errors ? `: ${errors}` : ""}`,
      );
    }

    return clients;
  }

  async getClient(instance: WorkspaceInstance): Promise<LspClient> {
    const entry = this.ensureEntry(instance);
    if (entry.state === "running" && entry.client?.isRunning()) {
      return entry.client;
    }
    if (entry.state === "failed") {
      throw entry.error ?? new Error(`${entry.key} failed to start`);
    }
    if (!entry.startPromise) this.startEntry(entry);
    return entry.startPromise!;
  }

  getRunningClients(): Array<{
    client: LspClient;
    instance: WorkspaceInstance;
  }> {
    return [...this.entries.values()].flatMap((entry) =>
      entry.state === "running" && entry.client?.isRunning()
        ? [{ client: entry.client, instance: entry.instance }]
        : [],
    );
  }

  async refreshChangedPath(filePath: string): Promise<void> {
    const absolutePath = resolve(filePath);
    invalidateFilePreviewCache(absolutePath);

    const refreshes = this.getRunningClients().flatMap(
      ({ client, instance }) => {
        const plugin = this.plugins[instance.language];
        if (!plugin) return [];
        if (!isPathInsideOrSame(absolutePath, instance.root)) return [];
        if (!acceptsFilePath(plugin, absolutePath)) return [];
        return [client.refreshOpenDocument(absolutePath)];
      },
    );

    await Promise.all(refreshes);
  }

  async refreshChangedPaths(filePaths: string[]): Promise<void> {
    const uniquePaths = [...new Set(filePaths.map((path) => resolve(path)))];
    await Promise.all(uniquePaths.map((path) => this.refreshChangedPath(path)));
  }

  getStatus(): ServerStatus[] {
    return [...this.entries.values()]
      .map((entry) => ({
        ...entry.instance,
        key: entry.key,
        state: entry.state,
        error: entry.error?.message,
      }))
      .sort(
        (a, b) =>
          a.language.localeCompare(b.language) || a.root.localeCompare(b.root),
      );
  }

  formatStatus(): string {
    const statuses = this.getStatus();
    if (statuses.length === 0) return "No LSP workspaces discovered";

    const languageWidth = Math.max(
      ...statuses.map((status) => status.language.length),
    );
    const rootWidth = Math.max(...statuses.map((status) => status.root.length));
    return statuses
      .map((status) => {
        const language = status.language.padEnd(languageWidth);
        const root = status.root.padEnd(rootWidth);
        const suffix = status.error
          ? `${status.state}: ${status.error}`
          : status.state;
        return `${language} ${root} ${suffix}`;
      })
      .join("\n");
  }

  async stop(languageOrKey?: string): Promise<number> {
    const entries = [...this.entries.values()].filter((entry) => {
      if (!languageOrKey) return true;
      return (
        entry.key === languageOrKey ||
        entry.instance.language === languageOrKey ||
        entry.key.startsWith(`${languageOrKey}:`)
      );
    });

    for (const entry of entries) {
      entry.state = "stopped";
      await entry.client?.stop().catch(() => {});
      this.entries.delete(entry.key);
    }

    if (!languageOrKey) this.discoveredInstances = [];
    return entries.length;
  }

  private ensureEntry(instance: WorkspaceInstance): ServerEntry {
    const normalizedInstance = { ...instance, root: resolve(instance.root) };
    const key = workspaceKey(
      normalizedInstance.language,
      normalizedInstance.root,
    );
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, instance: normalizedInstance, state: "discovered" };
      this.entries.set(key, entry);
    } else {
      entry.instance = normalizedInstance;
    }
    return entry;
  }

  private startEntry(entry: ServerEntry): void {
    const plugin = this.plugins[entry.instance.language];
    if (!plugin) {
      entry.state = "failed";
      entry.error = new Error(
        `Unsupported language: ${entry.instance.language}`,
      );
      return;
    }

    const client = new LspClient(
      entry.instance.language,
      plugin.getConfig(entry.instance.root),
      this.plugins,
      plugin.createIndexingTracker?.(),
    );

    entry.client = client;
    entry.state = "starting";
    entry.error = undefined;
    entry.startPromise = client
      .start()
      .then(() => {
        entry.state = "running";
        return client;
      })
      .catch((error: unknown) => {
        entry.state = "failed";
        entry.error = error instanceof Error ? error : new Error(String(error));
        throw entry.error;
      });

    void entry.startPromise.catch(() => {});
  }
}
