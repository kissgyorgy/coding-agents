import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IndexingTracker } from "./languages";
import type { Diagnostic, WatchedFileChange } from "./types";

export interface LspServerConfig {
  command: string;
  args: string[];
  rootUri: string;
  settings?: unknown;
}

interface LspMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface DiagnosticWaiter {
  expectedVersion: number;
  minimumGeneration: number;
  updated: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DIAGNOSTIC_QUIET_MS = 200;

export class LspClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private initialized = false;
  private language: string;
  private configs: LspServerConfig[];
  private config: LspServerConfig | null = null;
  private openDocuments = new Set<string>();
  private documentVersions = new Map<string, number>();
  private documentContents = new Map<string, string>();
  private languagePlugins: Record<
    string,
    { languageIdForPath: (filePath: string) => string | null }
  >;

  openDocumentCount(): number {
    return this.openDocuments.size;
  }

  getOpenDocumentPaths(): string[] {
    return [...this.openDocuments].map((uri) => {
      try {
        return fileURLToPath(uri);
      } catch {
        return uri;
      }
    });
  }
  private diagnostics = new Map<string, Diagnostic[]>();
  private diagnosticVersions = new Map<string, number>();
  private diagnosticGenerations = new Map<string, number>();
  private nextDiagnosticGeneration = 1;
  private diagnosticWaiters = new Map<string, DiagnosticWaiter[]>();
  private indexingDone = false;
  private indexingWaiters: Array<{
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    language: string,
    configs: LspServerConfig[],
    languagePlugins: Record<
      string,
      { languageIdForPath: (filePath: string) => string | null }
    >,
    private indexingTracker?: IndexingTracker,
  ) {
    this.language = language;
    this.configs = configs;
    this.languagePlugins = languagePlugins;
  }

  async start(): Promise<void> {
    if (this.process && this.initialized) return;

    let lastError: Error | null = null;
    for (const config of this.configs) {
      try {
        await this.startWithConfig(config);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await this.stop().catch(() => {});
      }
    }

    throw new Error(
      `Unable to start ${this.language} LSP server. Last error: ${lastError?.message ?? "unknown error"}`,
    );
  }

  private clearPendingRequest(id: number): PendingRequest | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    return pending;
  }

  private rejectAllPending(error: Error): void {
    for (const id of this.pending.keys()) {
      const pending = this.clearPendingRequest(id);
      pending?.reject(error);
    }
  }

  async stop(): Promise<void> {
    if (!this.process) {
      this.initialized = false;
      this.config = null;
      this.buffer = Buffer.alloc(0);
      this.openDocuments.clear();
      this.documentVersions.clear();
      this.documentContents.clear();
      this.diagnostics.clear();
      this.diagnosticVersions.clear();
      this.diagnosticGenerations.clear();
      this.rejectAllPending(new Error("LSP server stopped"));
      this.clearDiagnosticWaiters();
      this.clearIndexingWaiters();
      return;
    }

    if (this.initialized) {
      try {
        await this.request("shutdown", null);
        this.notify("exit", null);
      } catch {}
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
    this.config = null;
    this.openDocuments.clear();
    this.documentVersions.clear();
    this.documentContents.clear();
    this.diagnostics.clear();
    this.diagnosticVersions.clear();
    this.diagnosticGenerations.clear();
    this.buffer = Buffer.alloc(0);
    this.clearDiagnosticWaiters();
    this.clearIndexingWaiters();
  }

  private async startWithConfig(config: LspServerConfig): Promise<void> {
    this.config = config;
    this.buffer = Buffer.alloc(0);

    this.process = spawn(config.command, config.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => this.onData(data));

    let stderr = "";
    this.process.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    this.process.on("error", (error) => {
      this.rejectAllPending(
        error instanceof Error ? error : new Error(String(error)),
      );
    });

    this.process.on("exit", (code) => {
      this.process = null;
      this.initialized = false;
      this.rejectAllPending(
        new Error(
          `LSP server exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });

    await this.initialize();
  }

  private async initialize(): Promise<void> {
    if (!this.config) throw new Error("No LSP config selected");

    await this.request("initialize", {
      processId: process.pid,
      capabilities: {
        textDocument: {
          definition: {},
          references: {},
          rename: { prepareSupport: true },
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
          completion: {
            completionItem: {
              snippetSupport: false,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          publishDiagnostics: { versionSupport: true },
        },
        workspace: {
          symbol: {},
          workspaceFolders: true,
        },
        window: {
          workDoneProgress: true,
        },
      },
      rootUri: this.config.rootUri,
      workspaceFolders: [{ uri: this.config.rootUri, name: "workspace" }],
    });

    this.notify("initialized", {});
    if (this.config.settings !== undefined) {
      this.notify("workspace/didChangeConfiguration", {
        settings: this.config.settings,
      });
    }
    this.initialized = true;
  }

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.subarray(bodyStart + contentLength);

      try {
        const msg: LspMessage = JSON.parse(body.toString("utf8"));
        this.handleMessage(msg);
      } catch {}
    }
  }

  private handleMessage(msg: LspMessage): void {
    // Forward to indexing tracker first
    if (this.indexingTracker) {
      this.indexingTracker.handleMessage(msg);
      if (!this.indexingDone && this.indexingTracker.isDone()) {
        this.indexingDone = true;
        for (const w of this.indexingWaiters) {
          clearTimeout(w.timer);
          w.resolve();
        }
        this.indexingWaiters = [];
      }
    }

    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as {
        uri: string;
        version?: number;
        diagnostics: Diagnostic[];
      };
      const documentVersion = this.documentVersions.get(params.uri);
      // Analysis is asynchronous. Do not let a delayed publication for an old
      // buffer version replace diagnostics for the current document.
      if (
        params.version !== undefined &&
        documentVersion !== undefined &&
        params.version < documentVersion
      ) {
        return;
      }

      this.diagnostics.set(params.uri, params.diagnostics);
      if (params.version !== undefined) {
        this.diagnosticVersions.set(params.uri, params.version);
      } else {
        this.diagnosticVersions.delete(params.uri);
      }
      this.diagnosticGenerations.set(
        params.uri,
        this.nextDiagnosticGeneration++,
      );

      const waiters = this.diagnosticWaiters.get(params.uri);
      if (waiters) {
        for (const waiter of [...waiters]) {
          if (
            this.hasCurrentDiagnostics(
              params.uri,
              waiter.expectedVersion,
              waiter.minimumGeneration,
            )
          ) {
            waiter.updated();
          }
        }
      }
      return;
    }

    if (
      msg.method === "window/workDoneProgress/create" &&
      msg.id !== undefined
    ) {
      this.send({ jsonrpc: "2.0", id: msg.id, result: null });
      return;
    }

    if (msg.id !== undefined && !msg.method) {
      const pending = this.clearPendingRequest(msg.id);
      if (!pending) return;

      if (msg.error) {
        pending.reject(
          new Error(`LSP error ${msg.error.code}: ${msg.error.message}`),
        );
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private send(msg: LspMessage): void {
    if (!this.process?.stdin?.writable) {
      throw new Error("LSP server not running");
    }
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  private request(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Aborted"));
        return;
      }

      const id = this.nextId++;
      const timeout = setTimeout(() => {
        const pending = this.clearPendingRequest(id);
        if (!pending) return;
        signal?.removeEventListener("abort", onAbort);
        pending.reject(
          new Error(`LSP request "${method}" timed out after 30s`),
        );
      }, 30000);

      const onAbort = () => {
        const pending = this.clearPendingRequest(id);
        if (!pending) return;
        clearTimeout(timeout);
        pending.reject(new Error("Aborted"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, { resolve, reject, timeout });

      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        const pending = this.clearPendingRequest(id);
        if (!pending) return;
        signal?.removeEventListener("abort", onAbort);
        clearTimeout(timeout);
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  hasDocumentOpen(filePath: string): boolean {
    const absPath = resolve(filePath);
    const uri = pathToFileURL(absPath).href;
    return this.openDocuments.has(uri);
  }

  private nextDocumentVersion(uri: string): number {
    const version = (this.documentVersions.get(uri) ?? 0) + 1;
    this.documentVersions.set(uri, version);
    return version;
  }

  private resetDiagnosticsForUri(uri: string): void {
    this.diagnostics.delete(uri);
    this.diagnosticVersions.delete(uri);
    this.diagnosticGenerations.delete(uri);
  }

  private hasCurrentDiagnostics(
    uri: string,
    expectedVersion: number,
    minimumGeneration: number,
  ): boolean {
    const generation = this.diagnosticGenerations.get(uri);
    if (generation === undefined || generation <= minimumGeneration) {
      return false;
    }

    const publishedVersion = this.diagnosticVersions.get(uri);
    return (
      publishedVersion === undefined || publishedVersion === expectedVersion
    );
  }

  private rejectDiagnosticWaiters(uri: string): void {
    const waiters = this.diagnosticWaiters.get(uri);
    if (!waiters) return;
    const error = new Error(
      "Document closed before diagnostics were published",
    );
    for (const waiter of [...waiters]) waiter.reject(error);
  }

  private isMissingFileError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    );
  }

  async ensureDocumentOpen(filePath: string): Promise<string> {
    const absPath = resolve(filePath);
    const uri = pathToFileURL(absPath).href;

    if (!this.openDocuments.has(uri)) {
      const content = await readFile(absPath, "utf8");
      const languageId = this.getLanguageId(absPath);
      const version = this.nextDocumentVersion(uri);
      this.resetDiagnosticsForUri(uri);
      this.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version,
          text: content,
        },
      });
      this.openDocuments.add(uri);
      this.documentContents.set(uri, content);
    }

    return uri;
  }

  async refreshDocument(filePath: string, force = false): Promise<string> {
    const absPath = resolve(filePath);
    const uri = pathToFileURL(absPath).href;

    let content: string;
    try {
      content = await readFile(absPath, "utf8");
    } catch (error) {
      if (this.isMissingFileError(error)) {
        await this.closeDocument(absPath);
        return uri;
      }
      throw error;
    }

    if (
      !force &&
      this.openDocuments.has(uri) &&
      this.documentContents.get(uri) === content
    ) {
      return uri;
    }

    const version = this.nextDocumentVersion(uri);
    this.resetDiagnosticsForUri(uri);

    if (this.openDocuments.has(uri)) {
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
      this.documentContents.set(uri, content);
      return uri;
    }

    const languageId = this.getLanguageId(absPath);
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version,
        text: content,
      },
    });
    this.openDocuments.add(uri);
    this.documentContents.set(uri, content);
    return uri;
  }

  async refreshOpenDocument(filePath: string): Promise<void> {
    if (!this.hasDocumentOpen(filePath)) return;
    await this.refreshDocument(filePath);
  }

  async closeDocument(filePath: string): Promise<void> {
    const absPath = resolve(filePath);
    const uri = pathToFileURL(absPath).href;
    if (this.openDocuments.has(uri)) {
      this.notify("textDocument/didClose", {
        textDocument: { uri },
      });
    }
    this.openDocuments.delete(uri);
    this.documentVersions.delete(uri);
    this.documentContents.delete(uri);
    this.diagnostics.delete(uri);
    this.diagnosticVersions.delete(uri);
    this.diagnosticGenerations.delete(uri);
    this.rejectDiagnosticWaiters(uri);
  }

  notifyWatchedFileChanges(changes: WatchedFileChange[]): void {
    if (changes.length === 0) return;
    this.notify("workspace/didChangeWatchedFiles", {
      changes: changes.map((change) => ({
        uri: pathToFileURL(resolve(change.filePath)).href,
        type: change.type,
      })),
    });
  }

  private getLanguageId(filePath: string): string {
    for (const plugin of Object.values(this.languagePlugins)) {
      const id = plugin.languageIdForPath(filePath);
      if (id) return id;
    }
    return this.language;
  }

  async definition(
    filePath: string,
    line: number,
    character: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const uri = await this.ensureDocumentOpen(filePath);
    return this.request(
      "textDocument/definition",
      {
        textDocument: { uri },
        position: { line, character },
      },
      signal,
    );
  }

  async references(
    filePath: string,
    line: number,
    character: number,
    includeDeclaration = true,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const uri = await this.ensureDocumentOpen(filePath);
    return this.request(
      "textDocument/references",
      {
        textDocument: { uri },
        position: { line, character },
        context: { includeDeclaration },
      },
      signal,
    );
  }

  async rename(
    filePath: string,
    line: number,
    character: number,
    newName: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const uri = await this.ensureDocumentOpen(filePath);
    return this.request(
      "textDocument/rename",
      {
        textDocument: { uri },
        position: { line, character },
        newName,
      },
      signal,
    );
  }

  async documentSymbols(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const uri = await this.ensureDocumentOpen(filePath);
    return this.request(
      "textDocument/documentSymbol",
      {
        textDocument: { uri },
      },
      signal,
    );
  }

  async workspaceSymbol(query: string, signal?: AbortSignal): Promise<unknown> {
    return this.request("workspace/symbol", { query }, signal);
  }

  async completion(
    filePath: string,
    line: number,
    character: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const uri = await this.ensureDocumentOpen(filePath);
    return this.request(
      "textDocument/completion",
      {
        textDocument: { uri },
        position: { line, character },
      },
      signal,
    );
  }

  async getDiagnostics(
    filePath: string,
    signal?: AbortSignal,
  ): Promise<Diagnostic[]> {
    const absPath = resolve(filePath);
    const minimumGeneration = this.nextDiagnosticGeneration - 1;
    // A same-content didChange gives this diagnostic pass a new document
    // version instead of reusing whichever publication happens to be cached.
    const uri = await this.refreshDocument(absPath, true);
    if (!this.openDocuments.has(uri)) return [];

    const expectedVersion = this.documentVersions.get(uri);
    if (expectedVersion === undefined) {
      throw new Error(`No document version available for ${absPath}`);
    }

    await this.waitForDocumentDiagnostics(
      uri,
      expectedVersion,
      minimumGeneration,
      5000,
      signal,
    );
    return this.diagnostics.get(uri) ?? [];
  }

  isRunning(): boolean {
    return this.process !== null && this.initialized;
  }

  private clearDiagnosticWaiters(): void {
    const error = new Error("LSP server stopped");
    for (const waiters of [...this.diagnosticWaiters.values()]) {
      for (const waiter of [...waiters]) waiter.reject(error);
    }
    this.diagnosticWaiters.clear();
  }

  private clearIndexingWaiters(): void {
    this.indexingDone = false;
    for (const w of this.indexingWaiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
    this.indexingWaiters = [];
  }

  async waitForIndexing(
    timeoutMs = 30000,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.indexingTracker || this.indexingDone) return;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const onAbort = () => settle(() => reject(new Error("Aborted")));
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => settle(resolve), timeoutMs);
      this.indexingWaiters.push({ resolve: () => settle(resolve), timer });
    });
  }

  private async waitForDocumentDiagnostics(
    uri: string,
    expectedVersion: number,
    minimumGeneration: number,
    timeoutMs = 5000,
    signal?: AbortSignal,
  ): Promise<void> {
    const alreadyCurrent = this.hasCurrentDiagnostics(
      uri,
      expectedVersion,
      minimumGeneration,
    );

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      let quietTimer: ReturnType<typeof setTimeout> | undefined;
      let waiter: DiagnosticWaiter;

      const removeWaiter = () => {
        const waiters = this.diagnosticWaiters.get(uri);
        if (!waiters) return;
        const remaining = waiters.filter((candidate) => candidate !== waiter);
        if (remaining.length > 0) {
          this.diagnosticWaiters.set(uri, remaining);
        } else {
          this.diagnosticWaiters.delete(uri);
        }
      };
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (quietTimer) clearTimeout(quietTimer);
        signal?.removeEventListener("abort", onAbort);
        removeWaiter();
        fn();
      };
      const onAbort = () => settle(() => reject(new Error("Aborted")));
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(
        () =>
          settle(() =>
            reject(
              new Error(
                `Timed out waiting for diagnostics for document version ${expectedVersion}`,
              ),
            ),
          ),
        timeoutMs,
      );
      waiter = {
        expectedVersion,
        minimumGeneration,
        // Some servers publish an empty result immediately before their real
        // diagnostics. Accept the latest matching publication after a short
        // quiet period rather than racing the first notification.
        updated: () => {
          if (quietTimer) clearTimeout(quietTimer);
          quietTimer = setTimeout(() => settle(resolve), DIAGNOSTIC_QUIET_MS);
        },
        resolve: () => settle(resolve),
        reject: (error) => settle(() => reject(error)),
        timer,
      };
      const waiters = this.diagnosticWaiters.get(uri) ?? [];
      waiters.push(waiter);
      this.diagnosticWaiters.set(uri, waiters);
      if (alreadyCurrent) waiter.updated();
    });
  }
}
