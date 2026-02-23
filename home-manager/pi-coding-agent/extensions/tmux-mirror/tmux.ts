/**
 * Tmux backend for the tmux-mirror extension.
 *
 * Uses tmux split panes and `tmux wait-for` for instant signaling.
 * State is stored in tmux session environment variables (no temp files).
 */
import type { ExecFn, MirrorBackend } from "./types.js";
import { sleep } from "./types.js";

const WAIT_CHANNEL = "pi-prompt";
const ENV_PANE_ID = "PI_MIRROR_PANE";
const ENV_LAST_RC = "PI_LAST_RC";

export class TmuxBackend implements MirrorBackend {
  readonly label = "tmux";

  private target: string;
  private paneReady = false;
  private exec: ExecFn;
  private onReset?: () => void;

  constructor(exec: ExecFn, onReset?: () => void) {
    this.exec = exec;
    this.onReset = onReset;
    this.target = process.env.TMUX_MIRROR_TARGET || "";
  }

  // ── tmux primitives ────────────────────────────────────

  private async tmux(
    ...args: string[]
  ): Promise<{ stdout: string; code: number }> {
    const r = await this.exec("tmux", args, { timeout: 5000 });
    return { stdout: r.stdout, code: r.code ?? 1 };
  }

  private async getEnv(name: string): Promise<string> {
    const r = await this.tmux("show-environment", name);
    if (r.code !== 0) return "";
    const line = r.stdout.trim();
    if (line.startsWith("-")) return "";
    const eq = line.indexOf("=");
    return eq >= 0 ? line.slice(eq + 1) : "";
  }

  private async setEnv(name: string, value: string): Promise<void> {
    await this.tmux("set-environment", name, value);
  }

  private async unsetEnv(name: string): Promise<void> {
    await this.tmux("set-environment", "-u", name);
  }

  // ── pane lifecycle ─────────────────────────────────────

  private async checkPaneAlive(paneId: string): Promise<boolean> {
    if (!paneId) return false;
    try {
      const r = await this.exec("tmux", ["list-panes", "-F", "#{pane_id}"], {
        timeout: 2000,
      });
      return r.stdout.trim().split("\n").includes(paneId);
    } catch {
      return false;
    }
  }

  async paneAlive(): Promise<boolean> {
    return this.checkPaneAlive(this.target);
  }

  isPaneReady(): boolean {
    return this.paneReady;
  }

  async resetState(): Promise<void> {
    this.paneReady = false;
    this.target = process.env.TMUX_MIRROR_TARGET || "";
    await this.unsetEnv(ENV_LAST_RC).catch(() => {});
    this.onReset?.();
  }

  displayTarget(): string {
    return this.target;
  }

  private async waitForShell(timeoutMs = 10000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const cmd = (
        await this.tmux(
          "display-message",
          "-t",
          this.target,
          "-p",
          "#{pane_current_command}",
        )
      ).stdout.trim();
      if (cmd && /sh$/.test(cmd)) return true;
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

    if ((await this.tmux("has-session")).code !== 0) return false;

    if (this.target) {
      if (await this.checkPaneAlive(this.target)) {
        this.paneReady = true;
        return true;
      }
      return false;
    }

    const savedId = await this.getEnv(ENV_PANE_ID);
    if (savedId && (await this.checkPaneAlive(savedId))) {
      this.target = savedId;
      this.paneReady = true;
      return true;
    }

    const split = await this.tmux(
      "split-window",
      "-h",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
    );
    if (split.code !== 0) return false;

    this.target = split.stdout.trim();
    await this.setEnv(ENV_PANE_ID, this.target);

    if (!(await this.waitForShell())) {
      await this.tmux("kill-pane", "-t", this.target);
      this.target = "";
      return false;
    }

    this.paneReady = true;
    return true;
  }

  // ── capture & cwd ──────────────────────────────────────

  async capturePane(lines = 2000): Promise<string> {
    return (
      await this.tmux(
        "capture-pane",
        "-p",
        "-J",
        "-t",
        this.target,
        "-S",
        `-${lines}`,
      )
    ).stdout;
  }

  async getPaneCwd(): Promise<string> {
    return (
      await this.tmux(
        "display-message",
        "-t",
        this.target,
        "-p",
        "#{pane_current_path}",
      )
    ).stdout.trim();
  }

  // ── send keys ──────────────────────────────────────────

  async sendText(text: string): Promise<void> {
    await this.tmux("send-keys", "-t", this.target, "-l", text);
  }

  async sendEnter(): Promise<void> {
    await this.tmux("send-keys", "-t", this.target, "Enter");
  }

  async sendCtrlC(): Promise<void> {
    await this.tmux("send-keys", "-t", this.target, "C-c");
  }

  // ── shell info ─────────────────────────────────────────

  async getShellName(): Promise<string> {
    return (
      await this.tmux(
        "display-message",
        "-t",
        this.target,
        "-p",
        "#{pane_current_command}",
      )
    ).stdout.trim();
  }

  // ── hook & signaling ───────────────────────────────────

  generateHookCode(shell: string): string {
    const envSetup = `export PAGER=cat GIT_PAGER=cat`;

    if (shell.includes("zsh")) {
      return [
        envSetup,
        `typeset -gi __pi_seq=0`,
        `__pi_precmd() { local rc=$?; tmux set-environment ${ENV_LAST_RC} "$((++__pi_seq)) $rc"; tmux wait-for -S ${WAIT_CHANNEL} 2>/dev/null; return $rc; }`,
        `precmd_functions=(__pi_precmd $precmd_functions)`,
      ].join("; ");
    } else {
      return [
        envSetup,
        `__pi_seq=0`,
        `__pi_pcmd() { local rc=$?; tmux set-environment ${ENV_LAST_RC} "$((++__pi_seq)) $rc"; tmux wait-for -S ${WAIT_CHANNEL} 2>/dev/null; return $rc; }`,
        `PROMPT_COMMAND="__pi_pcmd;\${PROMPT_COMMAND}"`,
      ].join("; ");
    }
  }

  async prepareForHook(): Promise<void> {
    await this.unsetEnv(ENV_LAST_RC).catch(() => {});
  }

  async readRc(): Promise<{ seq: number; rc: number }> {
    try {
      const val = await this.getEnv(ENV_LAST_RC);
      if (!val) return { seq: 0, rc: 0 };
      const [s, r] = val.split(" ");
      return { seq: parseInt(s, 10) || 0, rc: parseInt(r, 10) || 0 };
    } catch {
      return { seq: 0, rc: 0 };
    }
  }

  async waitForPrompt(timeoutMs: number): Promise<boolean> {
    try {
      const r = await this.exec("tmux", ["wait-for", WAIT_CHANNEL], {
        timeout: timeoutMs,
      });
      return r.code === 0;
    } catch {
      return false;
    }
  }

  async unblockWait(): Promise<void> {
    await this.tmux("wait-for", "-S", WAIT_CHANNEL).catch(() => {});
  }

  cleanup(): void {
    // tmux state lives in session env variables, nothing to clean up
  }
}
