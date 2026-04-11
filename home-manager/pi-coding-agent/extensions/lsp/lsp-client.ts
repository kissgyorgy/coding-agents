import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IndexingTracker } from "./languages";

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
        return new URL(uri).pathname;
      } catch {
        return uri;
      }
    });
  }
  private diagnostics = new Map<string, unknown[]>();
  private diagnosticsReceivedUris = new Set<string>();
  private diagnosticWaiters = new Map<
    string,
    Array<{
      resolve: () => void;
      timer: ReturnType<typeof setTimeout>;
    }>
  >();
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
      this.rejectAllPending(new Error("LSP server stopped"));
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
    this.buffer = Buffer.alloc(0);
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
          publishDiagnostics: {},
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
      const params = msg.params as { uri: string; diagnostics: unknown[] };
      this.diagnostics.set(params.uri, params.diagnostics);
      if (!this.diagnosticsReceivedUris.has(params.uri)) {
        this.diagnosticsReceivedUris.add(params.uri);
        const waiters = this.diagnosticWaiters.get(params.uri);
        if (waiters) {
          this.diagnosticWaiters.delete(params.uri);
          for (const w of waiters) {
            clearTimeout(w.timer);
            w.resolve();
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

  async ensureDocumentOpen(filePath: string): Promise<string> {
    const absPath = resolve(filePath);
    const uri = pathToFileURL(absPath).href;

    if (!this.openDocuments.has(uri)) {
      const content = await readFile(absPath, "utf8");
      const languageId = this.getLanguageId(absPath);
      this.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: content,
        },
      });
      this.openDocuments.add(uri);
    }

    return uri;
  }

  async refreshDocument(filePath: string): Promise<string> {
    const absPath = resolve(filePath);
    const uri = pathToFileURL(absPath).href;
    const content = await readFile(absPath, "utf8");
    const languageId = this.getLanguageId(absPath);

    if (this.openDocuments.has(uri)) {
      this.notify("textDocument/didClose", {
        textDocument: { uri },
      });
    }

    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: Date.now(),
        text: content,
      },
    });
    this.openDocuments.add(uri);
    return uri;
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
  ): Promise<unknown[]> {
    const absPath = resolve(filePath);
    const uri = pathToFileURL(absPath).href;
    await this.refreshDocument(filePath);
    await this.waitForDocumentDiagnostics(uri, 15000, signal);
    return this.diagnostics.get(uri) ?? [];
  }

  isRunning(): boolean {
    return this.process !== null && this.initialized;
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
    timeoutMs = 15000,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.diagnosticsReceivedUris.has(uri)) return;

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
      const waiters = this.diagnosticWaiters.get(uri) ?? [];
      waiters.push({ resolve: () => settle(resolve), timer });
      this.diagnosticWaiters.set(uri, waiters);
    });
  }
}
