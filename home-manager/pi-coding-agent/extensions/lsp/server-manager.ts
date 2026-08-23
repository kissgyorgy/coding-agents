import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { invalidateFilePreviewCache } from "./formatters";
import { LspClient } from "./lsp-client";
import { languages, type LanguagePlugin } from "./languages";
import { isPathInsideOrSame } from "./languages/utils";
import {
  FILE_CHANGE_TYPE,
  type Diagnostic,
  type FileChangeType,
} from "./types";
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

export type FileDiagnostics = {
  filePath: string;
  language: string;
  diagnostics: Diagnostic[];
  error?: string;
};

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

  async refreshChangedPath(
    filePath: string,
    changeType: FileChangeType = FILE_CHANGE_TYPE.Changed,
  ): Promise<void> {
    const absolutePath = resolve(filePath);
    invalidateFilePreviewCache(absolutePath);

    const refreshes = this.getRunningClients().flatMap(
      ({ client, instance }) => {
        if (!isPathInsideOrSame(absolutePath, instance.root)) return [];

        // didOpen alone does not invalidate every server's workspace/module
        // index for a newly created file. Mirror an editor's watched-file event.
        client.notifyWatchedFileChanges([
          { filePath: absolutePath, type: changeType },
        ]);

        const plugin = this.plugins[instance.language];
        if (!plugin || !acceptsFilePath(plugin, absolutePath)) return [];
        return [
          changeType === FILE_CHANGE_TYPE.Deleted
            ? client.closeDocument(absolutePath)
            : client.refreshOpenDocument(absolutePath),
        ];
      },
    );

    await Promise.all(refreshes);
  }

  async refreshChangedPaths(filePaths: string[]): Promise<void> {
    const uniquePaths = [...new Set(filePaths.map((path) => resolve(path)))];
    await Promise.all(uniquePaths.map((path) => this.refreshChangedPath(path)));
  }

  async refreshFile(
    cwd: string,
    filePath: string,
    changeType: FileChangeType = FILE_CHANGE_TYPE.Changed,
  ): Promise<void> {
    const absolutePath = resolve(filePath);
    const clients = await Promise.all(
      this.getLanguagesForFile(cwd, absolutePath).map(async (language) => {
        const { client } = await this.getClientForFile(
          cwd,
          language,
          absolutePath,
        );
        return client;
      }),
    );

    await this.refreshChangedPath(absolutePath, changeType);
    if (changeType === FILE_CHANGE_TYPE.Deleted) return;
    await Promise.all(
      clients.map((client) => client.refreshDocument(absolutePath)),
    );
  }

  async getDiagnosticsForChangedPaths(
    cwd: string,
    filePaths: string[],
    signal?: AbortSignal,
  ): Promise<FileDiagnostics[]> {
    const uniquePaths = [...new Set(filePaths.map((path) => resolve(path)))];
    const results = await Promise.all(
      uniquePaths.map(async (filePath): Promise<FileDiagnostics[]> => {
        try {
          if (!(await stat(filePath)).isFile()) return [];
        } catch {
          return [];
        }

        return Promise.all(
          this.getLanguagesForFile(cwd, filePath).map(
            async (language): Promise<FileDiagnostics> => {
              try {
                const { client } = await this.getClientForFile(
                  cwd,
                  language,
                  filePath,
                );
                const diagnostics = (await client.getDiagnostics(
                  filePath,
                  signal,
                )) as Diagnostic[];
                return { filePath, language, diagnostics };
              } catch (error) {
                return {
                  filePath,
                  language,
                  diagnostics: [],
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            },
          ),
        );
      }),
    );

    return results.flat();
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

  private getLanguagesForFile(cwd: string, filePath: string): string[] {
    return Object.entries(this.plugins).flatMap(([language, plugin]) => {
      if (!acceptsFilePath(plugin, filePath)) return [];
      const workspace = selectWorkspaceForFile(
        this.discoveredInstances,
        cwd,
        language,
        filePath,
        this.plugins,
      );
      return workspace ? [language] : [];
    });
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
