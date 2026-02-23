/**
 * Kitty backend for the tmux-mirror extension.
 *
 * Uses kitty's remote control protocol (`kitty @`) and a named pipe (FIFO)
 * for instant signaling. State is stored in temp files scoped by session UUID.
 */
import type { ExecFn, MirrorBackend } from "./types.js";
import { sq, sleep } from "./types.js";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";

export class KittyBackend implements MirrorBackend {
  readonly label = "kitty";

  private windowId = 0;
  private paneReady = false;
  private exec: ExecFn;
  private onReset?: () => void;

  private readonly myWindowId: number;
  private readonly paneIdFile: string;
  private readonly sessionId: string;
  private readonly rcFile: string;
  private readonly signalFifo: string;

  constructor(exec: ExecFn, onReset?: () => void) {
    this.exec = exec;
    this.onReset = onReset;
    this.myWindowId = parseInt(process.env.KITTY_WINDOW_ID || "0", 10);
    this.paneIdFile = `/tmp/pi-mirror-pane-${this.myWindowId || process.env.KITTY_PID || "unknown"}`;
    this.sessionId = randomUUID().slice(0, 8);
    this.rcFile = `/tmp/pi-mirror-rc-${this.sessionId}`;
    this.signalFifo = `/tmp/pi-mirror-signal-${this.sessionId}`;
  }

  // ── kitty primitives ───────────────────────────────────

  private async kitty(
    ...args: string[]
  ): Promise<{ stdout: string; code: number }> {
    const r = await this.exec("kitty", ["@", ...args], { timeout: 5000 });
    return { stdout: r.stdout, code: r.code ?? 1 };
  }

  private async getWindow(id: number): Promise<any | null> {
    const r = await this.kitty("ls");
    if (r.code !== 0) return null;
    try {
      const data = JSON.parse(r.stdout);
      for (const osWin of data) {
        for (const tab of osWin.tabs) {
          for (const win of tab.windows) {
            if (win.id === id) return win;
          }
        }
      }
    } catch {}
    return null;
  }

  private async findNewestWindow(): Promise<number | null> {
    const r = await this.kitty("ls");
    if (r.code !== 0) return null;
    try {
      const data = JSON.parse(r.stdout);
      let newest: { id: number } | null = null;
      for (const osWin of data) {
        for (const tab of osWin.tabs) {
          for (const win of tab.windows) {
            if (win.id !== this.myWindowId) {
              if (!newest || win.id > newest.id) {
                newest = { id: win.id };
              }
            }
          }
        }
      }
      return newest?.id ?? null;
    } catch {
      return null;
    }
  }

  // ── pane lifecycle ─────────────────────────────────────

  private async checkWindowAlive(id: number): Promise<boolean> {
    if (!id) return false;
    return (await this.getWindow(id)) !== null;
  }

  async paneAlive(): Promise<boolean> {
    return this.checkWindowAlive(this.windowId);
  }

  isPaneReady(): boolean {
    return this.paneReady;
  }

  async resetState(): Promise<void> {
    this.paneReady = false;
    this.windowId = 0;
    try {
      unlinkSync(this.rcFile);
    } catch {}
    try {
      unlinkSync(this.signalFifo);
    } catch {}
    this.onReset?.();
  }

  displayTarget(): string {
    return `kitty:${this.windowId}`;
  }

  private async waitForShell(timeoutMs = 10000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const win = await this.getWindow(this.windowId);
      if (win) {
        const cmdline = win.foreground_processes?.[0]?.cmdline?.[0] || "";
        if (/sh$/.test(cmdline)) return true;
      }
      await sleep(500);
    }
    return false;
  }

  async ensurePane(): Promise<boolean> {
    if (this.paneReady && (await this.paneAlive())) return true;

    if (this.paneReady) {
      await this.resetState();
      await sleep(500);
    }

    // Try to reuse saved pane
    try {
      const saved = readFileSync(this.paneIdFile, "utf-8").trim();
      const id = parseInt(saved, 10);
      if (id > 0 && (await this.checkWindowAlive(id))) {
        this.windowId = id;
        this.paneReady = true;
        return true;
      }
    } catch {}

    // Create new vsplit
    const r = await this.kitty("launch", "--location=vsplit", "--cwd=current");
    if (r.code !== 0) return false;

    const newId = parseInt(r.stdout.trim(), 10);
    if (isNaN(newId) || newId <= 0) {
      const fallbackId = await this.findNewestWindow();
      if (!fallbackId) return false;
      this.windowId = fallbackId;
    } else {
      this.windowId = newId;
    }

    // Focus back to agent window
    if (this.myWindowId > 0) {
      await this.kitty("focus-window", "--match", `id:${this.myWindowId}`);
    }

    writeFileSync(this.paneIdFile, String(this.windowId));

    if (!(await this.waitForShell())) {
      await this.kitty("close-window", "--match", `id:${this.windowId}`);
      this.windowId = 0;
      return false;
    }

    this.paneReady = true;
    return true;
  }

  // ── capture & cwd ──────────────────────────────────────

  async capturePane(lines = 2000): Promise<string> {
    const r = await this.kitty(
      "get-text",
      "--match",
      `id:${this.windowId}`,
      "--extent",
      "all",
    );
    if (r.code !== 0) return "";
    const allLines = r.stdout.split("\n");
    if (allLines.length <= lines) return r.stdout;
    return allLines.slice(-lines).join("\n");
  }

  async getPaneCwd(): Promise<string> {
    const win = await this.getWindow(this.windowId);
    if (!win) return process.cwd();
    return win.foreground_processes?.[0]?.cwd || win.cwd || process.cwd();
  }

  // ── send keys ──────────────────────────────────────────

  async sendText(text: string): Promise<void> {
    await this.exec(
      "bash",
      [
        "-c",
        `printf '%s' ${sq(text)} | kitty @ send-text --match id:${this.windowId} --stdin`,
      ],
      { timeout: 5000 },
    );
  }

  async sendEnter(): Promise<void> {
    await this.kitty("send-key", "--match", `id:${this.windowId}`, "Return");
  }

  async sendCtrlC(): Promise<void> {
    await this.kitty("send-key", "--match", `id:${this.windowId}`, "ctrl+c");
  }

  // ── shell info ─────────────────────────────────────────

  async getShellName(): Promise<string> {
    const win = await this.getWindow(this.windowId);
    if (!win) return "";
    return win.foreground_processes?.[0]?.cmdline?.[0] || "";
  }

  // ── hook & signaling ───────────────────────────────────

  generateHookCode(shell: string): string {
    const envSetup = `export PAGER=cat GIT_PAGER=cat`;

    if (shell.includes("zsh")) {
      return [
        envSetup,
        `typeset -gi __pi_seq=0`,
        `__pi_precmd() { local rc=$?; echo "$((++__pi_seq)) $rc" > ${this.rcFile}; (echo > ${this.signalFifo} &) 2>/dev/null; return $rc; }`,
        `precmd_functions=(__pi_precmd $precmd_functions)`,
      ].join("; ");
    } else {
      return [
        envSetup,
        `__pi_seq=0`,
        `__pi_pcmd() { local rc=$?; echo "$((++__pi_seq)) $rc" > ${this.rcFile}; (echo > ${this.signalFifo} &) 2>/dev/null; return $rc; }`,
        `PROMPT_COMMAND="__pi_pcmd;\${PROMPT_COMMAND}"`,
      ].join("; ");
    }
  }

  async prepareForHook(): Promise<void> {
    try {
      unlinkSync(this.rcFile);
    } catch {}
    try {
      unlinkSync(this.signalFifo);
    } catch {}
    await this.exec("mkfifo", [this.signalFifo], { timeout: 2000 });
  }

  async readRc(): Promise<{ seq: number; rc: number }> {
    try {
      const val = readFileSync(this.rcFile, "utf-8").trim();
      if (!val) return { seq: 0, rc: 0 };
      const [s, r] = val.split(" ");
      return { seq: parseInt(s, 10) || 0, rc: parseInt(r, 10) || 0 };
    } catch {
      return { seq: 0, rc: 0 };
    }
  }

  async waitForPrompt(timeoutMs: number): Promise<boolean> {
    // Block on FIFO signal (zero CPU, like tmux wait-for)
    try {
      const r = await this.exec("cat", [this.signalFifo], {
        timeout: timeoutMs,
      });
      return r.code === 0;
    } catch {
      return false;
    }
  }

  async unblockWait(): Promise<void> {
    await this.exec(
      "bash",
      ["-c", `(echo > ${this.signalFifo} &) 2>/dev/null`],
      { timeout: 2000 },
    ).catch(() => {});
  }

  cleanup(): void {
    try {
      unlinkSync(this.rcFile);
    } catch {}
    try {
      unlinkSync(this.signalFifo);
    } catch {}
  }
}
