/**
 * Shared Terminal Extension (tmux + kitty)
 *
 * Overrides the built-in bash tool to run commands in a shared terminal split.
 * Supports two backends:
 *   - tmux: splits via tmux, signals via `tmux wait-for`
 *   - kitty: splits via `kitty @` remote control, signals via named pipe (FIFO)
 *
 * The actual command text is sent directly — no wrappers, no markers.
 *
 * Completion and exit code are detected via a shell hook (precmd for zsh,
 * PROMPT_COMMAND for bash). The hook writes a sequence number + $? and
 * signals completion (tmux wait-for or named pipe/FIFO for kitty).
 * Both backends block with zero CPU until signaled.
 *
 * The user can also type commands in the pane. A background loop detects
 * new activity when the agent is idle and injects it into the conversation.
 *
 * Setup:
 *   - tmux: run pi inside tmux. A split pane is auto-created.
 *   - kitty: run pi inside kitty with remote control enabled
 *     (allow_remote_control=socket-only in kitty.conf). A vsplit is auto-created.
 *
 * Environment variables:
 *   TMUX_MIRROR_TARGET  - tmux target pane (default: auto-created split)
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  truncateTail,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";

const WAIT_CHANNEL = "pi-prompt";

// Tmux session environment variable names
const ENV_PANE_ID = "PI_MIRROR_PANE";
const ENV_LAST_RC = "PI_LAST_RC";

type Backend = "tmux" | "kitty";

export default function (pi: ExtensionAPI) {
  // ── backend detection ────────────────────────────────────

  let backend: Backend;
  if (process.env.TMUX) {
    backend = "tmux";
  } else if (process.env.KITTY_PID) {
    backend = "kitty";
  } else {
    return; // No supported terminal — bail out
  }

  // ── shared state ─────────────────────────────────────────

  let target = process.env.TMUX_MIRROR_TARGET || "";
  let kittyWindowId = 0;
  let paneReady = false;
  let hookInstalled = false;
  let promptHeight = 2;
  let promptSymbol = "$ ";
  let agentRunning = false;
  let activityLoopRunning = false;
  let activityAbort: AbortController | null = null;
  let lastSnapshot = "";

  // Kitty-specific paths (UUID-scoped so multiple agents don't collide)
  const myKittyWindowId = parseInt(process.env.KITTY_WINDOW_ID || "0", 10);
  const kittyPaneIdFile = `/tmp/pi-mirror-pane-${myKittyWindowId || process.env.KITTY_PID || "unknown"}`;
  const sessionId = randomUUID().slice(0, 8);
  const kittyRcFile = `/tmp/pi-mirror-rc-${sessionId}`;
  const kittySignalFifo = `/tmp/pi-mirror-signal-${sessionId}`;

  // ── common helpers ───────────────────────────────────────

  const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // ── tmux helpers ─────────────────────────────────────────

  async function tmuxExec(
    ...args: string[]
  ): Promise<{ stdout: string; code: number }> {
    const r = await pi.exec("tmux", args, { timeout: 5000 });
    return { stdout: r.stdout, code: r.code ?? 1 };
  }

  async function tmuxGetEnv(name: string): Promise<string> {
    const r = await tmuxExec("show-environment", name);
    if (r.code !== 0) return "";
    const line = r.stdout.trim();
    if (line.startsWith("-")) return "";
    const eq = line.indexOf("=");
    return eq >= 0 ? line.slice(eq + 1) : "";
  }

  async function tmuxSetEnv(name: string, value: string): Promise<void> {
    await tmuxExec("set-environment", name, value);
  }

  async function tmuxUnsetEnv(name: string): Promise<void> {
    await tmuxExec("set-environment", "-u", name);
  }

  // ── kitty helpers ────────────────────────────────────────

  async function kittyExec(
    ...args: string[]
  ): Promise<{ stdout: string; code: number }> {
    const r = await pi.exec("kitty", ["@", ...args], { timeout: 5000 });
    return { stdout: r.stdout, code: r.code ?? 1 };
  }

  /** Find a kitty window by ID in the `kitty @ ls` output. */
  async function kittyGetWindow(id: number): Promise<any | null> {
    const r = await kittyExec("ls");
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

  async function kittySendText(text: string): Promise<void> {
    await pi.exec(
      "bash",
      [
        "-c",
        `printf '%s' ${sq(text)} | kitty @ send-text --match id:${kittyWindowId} --stdin`,
      ],
      { timeout: 5000 },
    );
  }

  async function kittySendEnter(): Promise<void> {
    await kittyExec("send-key", "--match", `id:${kittyWindowId}`, "Return");
  }

  async function kittySendCtrlC(): Promise<void> {
    await kittyExec("send-key", "--match", `id:${kittyWindowId}`, "ctrl+c");
  }

  function readRcKitty(): { seq: number; rc: number } {
    try {
      const val = readFileSync(kittyRcFile, "utf-8").trim();
      if (!val) return { seq: 0, rc: 0 };
      const [s, r] = val.split(" ");
      return { seq: parseInt(s, 10) || 0, rc: parseInt(r, 10) || 0 };
    } catch {
      return { seq: 0, rc: 0 };
    }
  }

  // ── dispatch: pane lifecycle ─────────────────────────────

  async function resetState(): Promise<void> {
    paneReady = false;
    hookInstalled = false;
    if (backend === "tmux") {
      target = process.env.TMUX_MIRROR_TARGET || "";
      await tmuxUnsetEnv(ENV_LAST_RC).catch(() => {});
    } else {
      kittyWindowId = 0;
      try {
        unlinkSync(kittyRcFile);
      } catch {}
      try {
        unlinkSync(kittySignalFifo);
      } catch {}
    }
  }

  async function paneAlive(id?: string | number): Promise<boolean> {
    if (backend === "tmux") {
      const paneId = (id as string) || target;
      if (!paneId) return false;
      try {
        const r = await pi.exec("tmux", ["list-panes", "-F", "#{pane_id}"], {
          timeout: 2000,
        });
        return r.stdout.trim().split("\n").includes(paneId);
      } catch {
        return false;
      }
    } else {
      const winId = (id as number) || kittyWindowId;
      if (!winId) return false;
      return (await kittyGetWindow(winId)) !== null;
    }
  }

  async function waitForShell(timeoutMs = 10000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (backend === "tmux") {
        const cmd = (
          await tmuxExec(
            "display-message",
            "-t",
            target,
            "-p",
            "#{pane_current_command}",
          )
        ).stdout.trim();
        if (cmd && /sh$/.test(cmd)) return true;
      } else {
        const win = await kittyGetWindow(kittyWindowId);
        if (win) {
          const cmdline = win.foreground_processes?.[0]?.cmdline?.[0] || "";
          if (/sh$/.test(cmdline)) return true;
        }
      }
      await sleep(500);
    }
    return false;
  }

  async function ensurePane(): Promise<boolean> {
    if (paneReady && (await paneAlive())) return true;

    if (paneReady) {
      await resetState();
      await sleep(500);
    }

    if (backend === "tmux") {
      return ensurePaneTmux();
    } else {
      return ensurePaneKitty();
    }
  }

  async function ensurePaneTmux(): Promise<boolean> {
    if ((await tmuxExec("has-session")).code !== 0) return false;

    if (target) {
      if (await paneAlive(target)) {
        paneReady = true;
        return true;
      }
      return false;
    }

    const savedId = await tmuxGetEnv(ENV_PANE_ID);
    if (savedId && (await paneAlive(savedId))) {
      target = savedId;
      paneReady = true;
      return true;
    }

    const split = await tmuxExec(
      "split-window",
      "-h",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
    );
    if (split.code !== 0) return false;

    target = split.stdout.trim();
    await tmuxSetEnv(ENV_PANE_ID, target);

    if (!(await waitForShell())) {
      await tmuxExec("kill-pane", "-t", target);
      target = "";
      return false;
    }

    paneReady = true;
    return true;
  }

  async function ensurePaneKitty(): Promise<boolean> {
    // Check saved pane ID from a previous pi run
    try {
      const saved = readFileSync(kittyPaneIdFile, "utf-8").trim();
      const id = parseInt(saved, 10);
      if (id > 0 && (await paneAlive(id))) {
        kittyWindowId = id;
        paneReady = true;
        return true;
      }
    } catch {}

    // Create a new vsplit
    const r = await kittyExec("launch", "--location=vsplit", "--cwd=current");
    if (r.code !== 0) return false;

    const newId = parseInt(r.stdout.trim(), 10);
    if (isNaN(newId) || newId <= 0) {
      // --dont-take-focus may suppress ID output in older kitty versions.
      // Fallback: find the newest non-self window via kitty @ ls.
      const fallbackId = await kittyFindNewestWindow();
      if (!fallbackId) return false;
      kittyWindowId = fallbackId;
    } else {
      kittyWindowId = newId;
    }

    // Focus back to our window
    if (myKittyWindowId > 0) {
      await kittyExec("focus-window", "--match", `id:${myKittyWindowId}`);
    }

    writeFileSync(kittyPaneIdFile, String(kittyWindowId));

    if (!(await waitForShell())) {
      await kittyExec("close-window", "--match", `id:${kittyWindowId}`);
      kittyWindowId = 0;
      return false;
    }

    paneReady = true;
    return true;
  }

  /** Fallback: find the newest window that isn't ours. */
  async function kittyFindNewestWindow(): Promise<number | null> {
    const r = await kittyExec("ls");
    if (r.code !== 0) return null;
    try {
      const data = JSON.parse(r.stdout);
      let newest: { id: number; at: number } | null = null;
      for (const osWin of data) {
        for (const tab of osWin.tabs) {
          for (const win of tab.windows) {
            if (win.id !== myKittyWindowId) {
              // Use the highest ID as a proxy for "newest"
              if (!newest || win.id > newest.id) {
                newest = { id: win.id, at: win.id };
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

  // ── dispatch: capture & cwd ──────────────────────────────

  async function capturePane(lines = 2000): Promise<string> {
    if (backend === "tmux") {
      return (
        await tmuxExec(
          "capture-pane",
          "-p",
          "-J",
          "-t",
          target,
          "-S",
          `-${lines}`,
        )
      ).stdout;
    } else {
      const r = await kittyExec(
        "get-text",
        "--match",
        `id:${kittyWindowId}`,
        "--extent",
        "all",
      );
      if (r.code !== 0) return "";
      const allLines = r.stdout.split("\n");
      if (allLines.length <= lines) return r.stdout;
      return allLines.slice(-lines).join("\n");
    }
  }

  async function getPaneCwd(): Promise<string> {
    if (backend === "tmux") {
      return (
        await tmuxExec(
          "display-message",
          "-t",
          target,
          "-p",
          "#{pane_current_path}",
        )
      ).stdout.trim();
    } else {
      const win = await kittyGetWindow(kittyWindowId);
      if (!win) return process.cwd();
      // foreground_processes[0].cwd is the most accurate (reflects cd)
      return win.foreground_processes?.[0]?.cwd || win.cwd || process.cwd();
    }
  }

  // ── dispatch: send keys ──────────────────────────────────

  async function sendText(text: string): Promise<void> {
    if (backend === "tmux") {
      await tmuxExec("send-keys", "-t", target, "-l", text);
    } else {
      await kittySendText(text);
    }
  }

  async function sendEnter(): Promise<void> {
    if (backend === "tmux") {
      await tmuxExec("send-keys", "-t", target, "Enter");
    } else {
      await kittySendEnter();
    }
  }

  async function sendCtrlC(): Promise<void> {
    if (backend === "tmux") {
      await tmuxExec("send-keys", "-t", target, "C-c");
    } else {
      await kittySendCtrlC();
    }
  }

  // ── dispatch: shell hook ─────────────────────────────────

  async function getShellName(): Promise<string> {
    if (backend === "tmux") {
      return (
        await tmuxExec(
          "display-message",
          "-t",
          target,
          "-p",
          "#{pane_current_command}",
        )
      ).stdout.trim();
    } else {
      const win = await kittyGetWindow(kittyWindowId);
      if (!win) return "";
      return win.foreground_processes?.[0]?.cmdline?.[0] || "";
    }
  }

  async function installHook(): Promise<boolean> {
    if (hookInstalled) return true;

    const shell = await getShellName();
    const envSetup = `export PAGER=cat GIT_PAGER=cat`;

    let hook: string;
    if (shell.includes("zsh")) {
      if (backend === "tmux") {
        hook = [
          envSetup,
          `typeset -gi __pi_seq=0`,
          `__pi_precmd() { local rc=$?; tmux set-environment ${ENV_LAST_RC} "$((++__pi_seq)) $rc"; tmux wait-for -S ${WAIT_CHANNEL} 2>/dev/null; return $rc; }`,
          `precmd_functions=(__pi_precmd $precmd_functions)`,
        ].join("; ");
      } else {
        hook = [
          envSetup,
          `typeset -gi __pi_seq=0`,
          `__pi_precmd() { local rc=$?; echo "$((++__pi_seq)) $rc" > ${kittyRcFile}; (echo > ${kittySignalFifo} &) 2>/dev/null; return $rc; }`,
          `precmd_functions=(__pi_precmd $precmd_functions)`,
        ].join("; ");
      }
    } else {
      if (backend === "tmux") {
        hook = [
          envSetup,
          `__pi_seq=0`,
          `__pi_pcmd() { local rc=$?; tmux set-environment ${ENV_LAST_RC} "$((++__pi_seq)) $rc"; tmux wait-for -S ${WAIT_CHANNEL} 2>/dev/null; return $rc; }`,
          `PROMPT_COMMAND="__pi_pcmd;\${PROMPT_COMMAND}"`,
        ].join("; ");
      } else {
        hook = [
          envSetup,
          `__pi_seq=0`,
          `__pi_pcmd() { local rc=$?; echo "$((++__pi_seq)) $rc" > ${kittyRcFile}; (echo > ${kittySignalFifo} &) 2>/dev/null; return $rc; }`,
          `PROMPT_COMMAND="__pi_pcmd;\${PROMPT_COMMAND}"`,
        ].join("; ");
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      // Clear RC state and recreate FIFO
      if (backend === "tmux") {
        await tmuxUnsetEnv(ENV_LAST_RC).catch(() => {});
      } else {
        try {
          unlinkSync(kittyRcFile);
        } catch {}
        try {
          unlinkSync(kittySignalFifo);
        } catch {}
        await pi.exec("mkfifo", [kittySignalFifo], { timeout: 2000 });
      }

      // Send the hook inline
      await sendText(` ${hook} && clear`);
      await sendEnter();

      // Wait for the hook to prove it works
      let hookFired = false;
      if (backend === "tmux") {
        const result = await pi.exec("tmux", ["wait-for", WAIT_CHANNEL], {
          timeout: 5000,
        });
        const { seq } = await readRc();
        hookFired = seq > 0 || result.code === 0;
      } else {
        // Block on FIFO signal (like tmux wait-for)
        try {
          const result = await pi.exec("cat", [kittySignalFifo], {
            timeout: 5000,
          });
          const { seq } = readRcKitty();
          hookFired = seq > 0 || result.code === 0;
        } catch {
          hookFired = false;
        }
      }

      if (hookFired) {
        // Wait for the prompt to finish rendering
        await sleep(500);
        const pane = (await capturePane(50)).trimEnd();
        const paneLines = pane.split("\n");
        // Detect prompt height (trailing non-empty lines)
        let h = 0;
        for (let i = paneLines.length - 1; i >= 0; i--) {
          if (paneLines[i].trim()) h++;
          else break;
        }
        promptHeight = Math.max(1, h);
        // Detect prompt symbol from the last line
        const lastLine = paneLines[paneLines.length - 1].trim();
        const sym = lastLine.match(/^\S+/);
        if (sym) promptSymbol = sym[0];
        hookInstalled = true;
        return true;
      }

      await sleep(1000);
    }

    return false;
  }

  // ── dispatch: read RC & wait for prompt ──────────────────

  async function readRc(): Promise<{ seq: number; rc: number }> {
    if (backend === "tmux") {
      try {
        const val = await tmuxGetEnv(ENV_LAST_RC);
        if (!val) return { seq: 0, rc: 0 };
        const [s, r] = val.split(" ");
        return { seq: parseInt(s, 10) || 0, rc: parseInt(r, 10) || 0 };
      } catch {
        return { seq: 0, rc: 0 };
      }
    } else {
      return readRcKitty();
    }
  }

  async function waitForPrompt(timeoutMs: number): Promise<boolean> {
    if (backend === "tmux") {
      try {
        const r = await pi.exec("tmux", ["wait-for", WAIT_CHANNEL], {
          timeout: timeoutMs,
        });
        return r.code === 0;
      } catch {
        return false;
      }
    } else {
      // Block on FIFO signal (zero CPU, like tmux wait-for)
      try {
        const r = await pi.exec("cat", [kittySignalFifo], {
          timeout: timeoutMs,
        });
        return r.code === 0;
      } catch {
        return false;
      }
    }
  }

  // ── output extraction (shared) ───────────────────────────

  function isPromptLine(line: string): boolean {
    return line.trim().startsWith(promptSymbol);
  }

  function extractOutput(before: string, after: string): string {
    const bLines = before.split("\n");
    const aLines = after.split("\n");
    let d = 0;
    while (d < bLines.length && d < aLines.length && bLines[d] === aLines[d])
      d++;
    const lines = aLines.slice(d);

    let lastCmdIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (isPromptLine(lines[i]) && extractCommand(lines[i])) {
        lastCmdIdx = i;
      }
    }

    if (lastCmdIdx === -1) return lines.join("\n").trim();

    const out: string[] = [];
    for (let i = lastCmdIdx + 1; i < lines.length; i++) {
      if (isPromptLine(lines[i])) break;
      if (
        i + promptHeight - 1 < lines.length &&
        isPromptLine(lines[i + promptHeight - 1])
      )
        break;
      out.push(lines[i]);
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();

    return out.join("\n");
  }

  function extractCommand(line: string): string {
    let cmd = line.trim().slice(promptSymbol.length).trim();
    cmd = cmd.replace(/\s*\[[\d:]+\]\s*$/, "").trim();
    return cmd;
  }

  async function formatActivity(
    diff: string,
    exitCode: number,
  ): Promise<string | null> {
    const lines = diff.split("\n");

    let lastCmdIdx = -1;
    let lastCmd = "";
    for (let i = 0; i < lines.length; i++) {
      if (isPromptLine(lines[i])) {
        const cmd = extractCommand(lines[i]);
        if (cmd) {
          lastCmdIdx = i;
          lastCmd = cmd;
        }
      }
    }

    if (lastCmdIdx === -1) return null;

    const out: string[] = [];
    for (let i = lastCmdIdx + 1; i < lines.length; i++) {
      if (isPromptLine(lines[i])) break;
      if (
        i + promptHeight - 1 < lines.length &&
        isPromptLine(lines[i + promptHeight - 1])
      )
        break;
      out.push(lines[i]);
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();

    const cwd = await getPaneCwd();
    const home = process.env.HOME || "";
    const shortCwd =
      home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

    let result = `${shortCwd} $ ${lastCmd}`;
    if (out.length) result += `\n${out.join("\n")}`;
    result += `\n[exit code: ${exitCode}]`;
    return result;
  }

  // ── run a command in the pane ────────────────────────────

  async function runCommand(
    command: string,
    cwd: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<{ output: string; exitCode: number }> {
    if (!(await installHook())) {
      return {
        output:
          "Failed to set up the shared terminal hook. The shell in the pane may not be ready.",
        exitCode: 1,
      };
    }

    const before = await capturePane();
    const { seq: seqBefore } = await readRc();

    const paneCwd = await getPaneCwd();
    const needsCd = paneCwd !== cwd;
    let sendCmd = needsCd ? `cd ${sq(cwd)} && ${command}` : command;

    if (sendCmd.includes("\n")) {
      sendCmd = `{\n${sendCmd}\n}`;
    }

    await sendText(` ${sendCmd}`);
    await sendEnter();

    const timeout = timeoutMs || 120_000;
    const deadline = Date.now() + timeout;
    let exitCode = 0;
    let completed = false;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        await sendCtrlC();
        return { output: "Cancelled", exitCode: 130 };
      }

      const remaining = Math.min(deadline - Date.now(), 5000);
      if (remaining <= 0) break;

      const signaled = await waitForPrompt(remaining);

      if (signaled) {
        const { seq, rc } = await readRc();
        if (seq > seqBefore) {
          exitCode = rc;
          completed = true;
          break;
        }
      }

      if (!(await paneAlive())) {
        await resetState();
        return {
          output: "Terminal pane was closed during execution.",
          exitCode: 1,
        };
      }
    }

    if (!completed) {
      await sendCtrlC();
      await sleep(500);
    }

    await sleep(200);
    const after = await capturePane();
    let output = extractOutput(before, after);

    if (!completed) output += "\n[command timed out]";
    return { output, exitCode: completed ? exitCode : 124 };
  }

  // ── event-driven user activity detection ─────────────────

  function startActivityLoop() {
    if (activityLoopRunning || !paneReady) return;
    activityLoopRunning = true;
    activityAbort = new AbortController();

    (async () => {
      const { signal } = activityAbort!;
      // Track last-seen RC seq to filter stale FIFO signals
      let lastSeenSeq = (await readRc()).seq;

      while (!signal.aborted && paneReady) {
        if (agentRunning) {
          await sleep(250);
          // Re-sync seq after agent finishes so we don't mistake
          // agent commands for user activity
          lastSeenSeq = (await readRc()).seq;
          continue;
        }

        // Block until a command completes (zero CPU for both backends)
        const signaled = await waitForPrompt(30000);
        if (signal.aborted || !paneReady) break;
        if (agentRunning) continue;
        if (!signaled) {
          if (!(await paneAlive())) {
            await resetState();
            break;
          }
          continue;
        }

        // Verify a new command actually completed (filters stale FIFO signals)
        const { seq: currentSeq } = await readRc();
        if (currentSeq <= lastSeenSeq) continue;
        lastSeenSeq = currentSeq;

        if (agentRunning) continue;

        try {
          const dbg = (msg: string) => {
            try {
              writeFileSync(
                "/tmp/pi-mirror-debug.log",
                `${new Date().toISOString()} ${msg}\n`,
                { flag: "a" },
              );
            } catch {}
          };

          dbg(
            `signaled, agentRunning=${agentRunning}, promptSymbol=${JSON.stringify(promptSymbol)}, promptHeight=${promptHeight}`,
          );

          const current = (await capturePane(200)).trim();
          if (current === lastSnapshot) {
            dbg(`skip: same snapshot`);
            continue;
          }

          const bLines = lastSnapshot.split("\n");
          const aLines = current.split("\n");
          let i = 0;
          while (
            i < bLines.length &&
            i < aLines.length &&
            bLines[i] === aLines[i]
          )
            i++;
          const diff = aLines.slice(i).join("\n").trim();

          lastSnapshot = current;
          if (diff.length < 5) {
            dbg(`skip: diff too short (${diff.length})`);
            continue;
          }

          dbg(
            `diff (${diff.length} chars): ${JSON.stringify(diff.slice(0, 500))}`,
          );

          const { rc } = await readRc();
          const message = await formatActivity(diff, rc);
          dbg(
            `formatActivity result: ${JSON.stringify(message?.slice(0, 300) ?? null)}`,
          );
          if (!message) continue;

          pi.sendMessage(
            {
              customType: "tmux-activity",
              content: `User activity in the shared terminal:\n\n${message}`,
              display: true,
            },
            { deliverAs: "followUp", triggerTurn: false },
          );

          while (agentRunning && !signal.aborted) await sleep(500);
          if (signal.aborted || !paneReady) break;

          const postAgent = (await capturePane(200)).trim();
          if (postAgent !== lastSnapshot) {
            const pb = lastSnapshot.split("\n");
            const pa = postAgent.split("\n");
            let pi2 = 0;
            while (pi2 < pb.length && pi2 < pa.length && pb[pi2] === pa[pi2])
              pi2++;
            const postDiff = pa.slice(pi2).join("\n").trim();

            if (postDiff.length >= 5) {
              const { rc: postRc } = await readRc();
              const postMsg = await formatActivity(postDiff, postRc);
              if (postMsg) {
                pi.sendMessage(
                  {
                    customType: "tmux-activity",
                    content: `User activity in the shared terminal:\n\n${postMsg}`,
                    display: true,
                  },
                  { deliverAs: "followUp", triggerTurn: false },
                );
              }
            }
          }
          lastSnapshot = (await capturePane(200)).trim();
        } catch {}
      }

      activityLoopRunning = false;
    })();
  }

  function stopActivityLoop() {
    if (activityAbort) {
      activityAbort.abort();
      activityAbort = null;
    }
    // Unblock any reader waiting on the signal channel
    if (backend === "tmux") {
      tmuxExec("wait-for", "-S", WAIT_CHANNEL).catch(() => {});
    } else {
      pi.exec("bash", ["-c", `(echo > ${kittySignalFifo} &) 2>/dev/null`], {
        timeout: 2000,
      }).catch(() => {});
    }
  }

  // ── bash tool override ───────────────────────────────────

  const backendLabel = backend === "tmux" ? "tmux" : "kitty";

  pi.registerTool({
    name: "bash",
    label: `Bash (${backendLabel})`,
    description:
      "Execute a bash command in a shared terminal split. The terminal is " +
      "shared with the user — they may also run commands there. Use " +
      "read_terminal to see recent terminal activity including user commands.",
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({ description: "Timeout in seconds (default: 120)" }),
      ),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      try {
        if (!(await ensurePane())) {
          const hint =
            backend === "tmux"
              ? "Are you inside tmux?"
              : "Is kitty remote control enabled? (allow_remote_control in kitty.conf)";
          return {
            content: [
              {
                type: "text",
                text: `Error: could not create terminal pane. ${hint}`,
              },
            ],
            details: { command: params.command, exitCode: 1, cwd: ctx.cwd },
            isError: true,
          };
        }

        const displayTarget =
          backend === "tmux" ? target : `kitty:${kittyWindowId}`;
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Running in ${backendLabel} → ${displayTarget}…`,
            },
          ],
        });

        const ms = params.timeout ? params.timeout * 1000 : undefined;
        const { output, exitCode } = await runCommand(
          params.command,
          ctx.cwd,
          ms,
          signal,
        );

        if (paneReady) {
          lastSnapshot = (await capturePane(200)).trim();
        }

        const t = truncateTail(output, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });
        let text = t.content;
        if (t.truncated) {
          text =
            `[Truncated: last ${t.outputLines} of ${t.totalLines} lines ` +
            `(${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)})]\n` +
            text;
        }
        if (!text) text = "(no output)";

        return {
          content: [{ type: "text", text }],
          details: { command: params.command, exitCode, cwd: ctx.cwd },
          isError: exitCode !== 0,
        };
      } catch (err) {
        await resetState();
        return {
          content: [
            {
              type: "text",
              text: `tmux-mirror error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { command: params.command, exitCode: 1, cwd: ctx.cwd },
          isError: true,
        };
      }
    },
  });

  // ── read_terminal tool ───────────────────────────────────

  pi.registerTool({
    name: "read_terminal",
    label: "Read Terminal",
    description:
      "Read recent content from the shared terminal split. Shows output " +
      "from both agent and user commands.",
    parameters: Type.Object({
      lines: Type.Optional(
        Type.Number({ description: "Lines of scrollback (default: 200)" }),
      ),
    }),
    async execute(_id, params) {
      if (!(await ensurePane())) {
        return {
          content: [
            { type: "text", text: "Error: terminal pane not available" },
          ],
          isError: true,
        };
      }
      const text = (await capturePane(params.lines || 200)).trim();
      return {
        content: [{ type: "text", text: text || "(terminal is empty)" }],
        details: {},
      };
    },
  });

  // ── lifecycle ────────────────────────────────────────────

  pi.on("agent_start", () => {
    agentRunning = true;
  });

  pi.on("agent_end", () => {
    agentRunning = false;
  });

  pi.on("session_start", async (_event, ctx) => {
    const ok = await ensurePane();
    if (ok) {
      await installHook();
      lastSnapshot = (await capturePane(200)).trim();
      startActivityLoop();
      const displayTarget =
        backend === "tmux" ? target : `kitty:${kittyWindowId}`;
      ctx.ui.notify(`Shared ${backendLabel} pane → ${displayTarget}`, "info");
    }
  });

  pi.on("session_shutdown", () => {
    stopActivityLoop();
    // Clean up kitty temp files
    if (backend === "kitty") {
      try {
        unlinkSync(kittyRcFile);
      } catch {}
      try {
        unlinkSync(kittySignalFifo);
      } catch {}
    }
  });
}
