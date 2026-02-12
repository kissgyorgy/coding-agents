/**
 * Tmux Shared Terminal Extension
 *
 * Overrides the built-in bash tool to run commands in a shared tmux pane.
 * The actual command text is sent directly — no wrappers, no markers.
 *
 * Completion and exit code are detected via a shell hook (precmd for zsh,
 * PROMPT_COMMAND for bash) that stores a sequence number + $? in a tmux
 * session environment variable and signals `tmux wait-for -S pi-prompt`.
 * This gives instant, zero-CPU notification instead of polling.
 *
 * All state is stored in tmux session environment variables — no temp files.
 *
 * The user can also type commands in the pane. A background `wait-for`
 * loop detects new activity when the agent is idle and injects it into
 * the conversation.
 *
 * Setup: run pi inside tmux. A split pane is auto-created.
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
import { writeFileSync } from "node:fs";

const WAIT_CHANNEL = "pi-prompt";

// Tmux session environment variable names
const ENV_PANE_ID = "PI_MIRROR_PANE";
const ENV_DIFF_PANE_ID = "PI_DIFF_PANE";
const ENV_LAST_RC = "PI_LAST_RC";

export default function (pi: ExtensionAPI) {
  // Bail out if not inside tmux — no tools registered, no handlers
  if (!process.env.TMUX) return;

  let target = process.env.TMUX_MIRROR_TARGET || "";

  let paneReady = false;
  let hookInstalled = false;
  let promptHeight = 2;
  let promptSymbol = "$ ";  // detected from pane after clear
  let agentRunning = false;
  let activityLoopRunning = false;
  let activityAbort: AbortController | null = null;
  let lastSnapshot = "";

  // ── helpers ──────────────────────────────────────────────

  const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function tmuxExec(...args: string[]): Promise<{ stdout: string; code: number }> {
    const r = await pi.exec("tmux", args, { timeout: 5000 });
    return { stdout: r.stdout, code: r.code ?? 1 };
  }

  /** Read a tmux session environment variable. Returns "" if unset. */
  async function tmuxGetEnv(name: string): Promise<string> {
    const r = await tmuxExec("show-environment", name);
    if (r.code !== 0) return "";
    // Output format: "NAME=value\n" or "-NAME\n" (if unset)
    const line = r.stdout.trim();
    if (line.startsWith("-")) return "";
    const eq = line.indexOf("=");
    return eq >= 0 ? line.slice(eq + 1) : "";
  }

  /** Set a tmux session environment variable. */
  async function tmuxSetEnv(name: string, value: string): Promise<void> {
    await tmuxExec("set-environment", name, value);
  }

  /** Unset a tmux session environment variable. */
  async function tmuxUnsetEnv(name: string): Promise<void> {
    await tmuxExec("set-environment", "-u", name);
  }

  // ── pane lifecycle ───────────────────────────────────────

  async function resetState() {
    paneReady = false;
    hookInstalled = false;
    target = process.env.TMUX_MIRROR_TARGET || "";
    await tmuxUnsetEnv(ENV_LAST_RC).catch(() => {});
  }

  async function paneAlive(id: string): Promise<boolean> {
    if (!id) return false;
    try {
      const r = await pi.exec("tmux", ["list-panes", "-F", "#{pane_id}"], { timeout: 2000 });
      return r.stdout.trim().split("\n").includes(id);
    } catch {
      return false;
    }
  }

  async function waitForShell(timeoutMs = 10000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const cmd = (
        await tmuxExec("display-message", "-t", target, "-p", "#{pane_current_command}")
      ).stdout.trim();
      if (cmd && /sh$/.test(cmd)) return true;
      await sleep(500);
    }
    return false;
  }

  async function ensurePane(): Promise<boolean> {
    if (paneReady && (await paneAlive(target))) return true;

    if (paneReady) {
      await resetState();
      await sleep(500);
    }

    if ((await tmuxExec("has-session")).code !== 0) return false;

    if (target) {
      if (await paneAlive(target)) { paneReady = true; return true; }
      return false;
    }

    // Check if a pane ID was saved in the tmux session from a previous run
    const savedId = await tmuxGetEnv(ENV_PANE_ID);
    if (savedId && (await paneAlive(savedId))) {
      target = savedId;
      paneReady = true;
      return true;
    }

    const split = await tmuxExec("split-window", "-h", "-d", "-P", "-F", "#{pane_id}");
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

  async function capturePane(lines = 2000): Promise<string> {
    // -J joins wrapped lines into logical lines
    return (await tmuxExec("capture-pane", "-p", "-J", "-t", target, "-S", `-${lines}`)).stdout;
  }

  async function getPaneCwd(): Promise<string> {
    return (
      await tmuxExec("display-message", "-t", target, "-p", "#{pane_current_path}")
    ).stdout.trim();
  }

  // ── diff viewer pane ─────────────────────────────────────

  let diffPaneId = "";

  async function ensureDiffPane(): Promise<boolean> {
    // Check if saved pane is alive
    if (!diffPaneId) {
      const savedId = await tmuxGetEnv(ENV_DIFF_PANE_ID);
      if (savedId && (await paneAlive(savedId))) {
        diffPaneId = savedId;
      }
    }

    if (diffPaneId && (await paneAlive(diffPaneId))) return true;

    // Create a new pane below the command pane
    if (!target) return false;
    const split = await tmuxExec(
      "split-window", "-v", "-d", "-t", target,
      "-l", "30%",
      "-P", "-F", "#{pane_id}",
    );
    if (split.code !== 0) return false;

    diffPaneId = split.stdout.trim();
    await tmuxSetEnv(ENV_DIFF_PANE_ID, diffPaneId);
    await sleep(500);
    return true;
  }

  /** Refresh the diff viewer: kill whatever is running, send new diff command. */
  async function refreshDiff(): Promise<void> {
    if (!diffPaneId || !(await paneAlive(diffPaneId))) return;

    // q quits less if running (or types 'q' into shell).
    // C-c clears any partial input at shell prompt.
    await tmuxExec("send-keys", "-t", diffPaneId, "q");
    await sleep(100);
    await tmuxExec("send-keys", "-t", diffPaneId, "C-c");
    await sleep(100);

    const diffScript = [
      `printf '\\033[1;34m── git diff ──\\033[0m\\n\\n'`,
      `git --no-pager diff --color=always 2>/dev/null`,
      `git ls-files --others --exclude-standard 2>/dev/null | while IFS= read -r f; do git --no-pager diff --color=always --no-index /dev/null "$f" 2>/dev/null; done`,
    ].join("; ");
    const cmd = `{ ${diffScript}; } | less -Rc`;
    await tmuxExec("send-keys", "-t", diffPaneId, "-l", cmd);
    await tmuxExec("send-keys", "-t", diffPaneId, "Enter");
  }

  // ── shell hook ───────────────────────────────────────────

  async function installHook(): Promise<boolean> {
    if (hookInstalled) return true;

    const shell = (
      await tmuxExec("display-message", "-t", target, "-p", "#{pane_current_command}")
    ).stdout.trim();

    const envSetup = `export PAGER=cat GIT_PAGER=cat`;

    // The hook stores "<seq> <exit_code>" in a tmux env var, then signals wait-for.
    let hook: string;
    if (shell.includes("zsh")) {
      hook = [
        envSetup,
        `typeset -gi __pi_seq=0`,
        `__pi_precmd() { local rc=$?; tmux set-environment ${ENV_LAST_RC} "$((++__pi_seq)) $rc"; tmux wait-for -S ${WAIT_CHANNEL} 2>/dev/null; return $rc; }`,
        `precmd_functions=(__pi_precmd $precmd_functions)`,
      ].join("; ");
    } else {
      hook = [
        envSetup,
        `__pi_seq=0`,
        `__pi_pcmd() { local rc=$?; tmux set-environment ${ENV_LAST_RC} "$((++__pi_seq)) $rc"; tmux wait-for -S ${WAIT_CHANNEL} 2>/dev/null; return $rc; }`,
        `PROMPT_COMMAND="__pi_pcmd;\${PROMPT_COMMAND}"`,
      ].join("; ");
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      await tmuxUnsetEnv(ENV_LAST_RC).catch(() => {});

      // Send the hook inline — no temp file needed
      await tmuxExec("send-keys", "-t", target, "-l", `${hook} && clear`);
      await tmuxExec("send-keys", "-t", target, "Enter");

      // Wait for the hook to prove it works — use wait-for with a timeout
      const result = await pi.exec(
        "tmux", ["wait-for", WAIT_CHANNEL],
        { timeout: 5000 },
      );

      const { seq } = await readRc();
      if (seq > 0 || result.code === 0) {
        // Wait for the prompt to finish rendering (precmd fires before prompt draws)
        await sleep(500);
        const pane = (await capturePane(50)).trimEnd();
        const paneLines = pane.split("\n");
        // Detect prompt height (trailing non-empty lines = the prompt)
        let h = 0;
        for (let i = paneLines.length - 1; i >= 0; i--) {
          if (paneLines[i].trim()) h++;
          else break;
        }
        promptHeight = Math.max(1, h);
        // Detect prompt symbol from the last line (the input line)
        // Only take the first non-space token (avoids RPROMPT/timestamp/padding)
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

  async function readRc(): Promise<{ seq: number; rc: number }> {
    try {
      const val = await tmuxGetEnv(ENV_LAST_RC);
      if (!val) return { seq: 0, rc: 0 };
      const [s, r] = val.split(" ");
      return { seq: parseInt(s, 10) || 0, rc: parseInt(r, 10) || 0 };
    } catch {
      return { seq: 0, rc: 0 };
    }
  }

  // ── wait-for based prompt signal ─────────────────────────

  /**
   * Block until the next prompt signal (precmd fires in the pane).
   * Returns true if signaled, false on timeout or pane death.
   */
  async function waitForPrompt(timeoutMs: number): Promise<boolean> {
    try {
      const r = await pi.exec("tmux", ["wait-for", WAIT_CHANNEL], { timeout: timeoutMs });
      return r.code === 0;
    } catch {
      return false;
    }
  }

  // ── output extraction ────────────────────────────────────

  /** Check if a line is a prompt input line (contains the prompt symbol). */
  function isPromptLine(line: string): boolean {
    return line.trim().startsWith(promptSymbol);
  }

  /**
   * Extract command output from a pane diff.
   * Finds the last prompt line with a command, collects everything after it
   * until the next prompt block. Same logic as formatActivity.
   */
  function extractOutput(before: string, after: string): string {
    // Diff to get only new content
    const bLines = before.split("\n");
    const aLines = after.split("\n");
    let d = 0;
    while (d < bLines.length && d < aLines.length && bLines[d] === aLines[d]) d++;
    const lines = aLines.slice(d);

    // Find the last prompt line with a command
    let lastCmdIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (isPromptLine(lines[i]) && extractCommand(lines[i])) {
        lastCmdIdx = i;
      }
    }

    if (lastCmdIdx === -1) return lines.join("\n").trim();

    // Collect output after the command line until the next prompt block
    const out: string[] = [];
    for (let i = lastCmdIdx + 1; i < lines.length; i++) {
      if (isPromptLine(lines[i])) break;
      if (i + promptHeight - 1 < lines.length && isPromptLine(lines[i + promptHeight - 1])) break;
      out.push(lines[i]);
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();

    return out.join("\n");
  }

  /**
   * Extract command text from a prompt input line.
   * Strips the prompt symbol and any trailing timestamp like [HH:MM:SS].
   */
  function extractCommand(line: string): string {
    let cmd = line.trim().slice(promptSymbol.length).trim();
    // Strip trailing right-prompt / timestamp (with or without leading spaces)
    cmd = cmd.replace(/\s*\[[\d:]+\]\s*$/, "").trim();
    return cmd;
  }

  /**
   * Parse a pane diff to extract the last command, its output, and exit code.
   * Returns null if no actual commands were found.
   */
  async function formatActivity(diff: string, exitCode: number): Promise<string | null> {
    const lines = diff.split("\n");

    // Find ALL prompt lines with commands — we want the last one
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

    // Collect output: everything after the last command line that isn't a prompt
    const out: string[] = [];
    for (let i = lastCmdIdx + 1; i < lines.length; i++) {
      if (isPromptLine(lines[i])) break;
      // Skip prompt info lines that precede a prompt (look ahead)
      if (i + promptHeight - 1 < lines.length && isPromptLine(lines[i + promptHeight - 1])) break;
      out.push(lines[i]);
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();

    const cwd = await getPaneCwd();
    const home = process.env.HOME || "";
    const shortCwd = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

    let result = `${shortCwd} $ ${lastCmd}`;
    if (out.length) result += `\n${out.join("\n")}`;
    result += `\n[exit code: ${exitCode}]`;
    return result;
  }

  // ── run a command in the pane ────────────────────────────

  async function runInTmux(
    command: string,
    cwd: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<{ output: string; exitCode: number }> {
    if (!(await installHook())) {
      return {
        output: "Failed to set up the shared terminal hook. The shell in the pane may not be ready.",
        exitCode: 1,
      };
    }

    const before = await capturePane();
    const { seq: seqBefore } = await readRc();

    const paneCwd = await getPaneCwd();
    const needsCd = paneCwd !== cwd;
    let sendCmd = needsCd ? `cd ${sq(cwd)} && ${command}` : command;

    // Wrap multi-line commands in { } so the shell treats them as a single
    // compound command. Without this, each newline triggers a separate
    // precmd/PROMPT_COMMAND, and the agent's wait-for catches the first
    // signal before the remaining commands have executed.
    if (sendCmd.includes("\n")) {
      sendCmd = `{\n${sendCmd}\n}`;
    }

    await tmuxExec("send-keys", "-t", target, "-l", sendCmd);
    await tmuxExec("send-keys", "-t", target, "Enter");

    // Wait for prompt signal — blocks until precmd fires or timeout
    const timeout = timeoutMs || 120_000;
    const deadline = Date.now() + timeout;
    let exitCode = 0;
    let completed = false;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        await tmuxExec("send-keys", "-t", target, "C-c");
        return { output: "Cancelled", exitCode: 130 };
      }

      // Block on wait-for with a short timeout so we can check signal/pane
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
        // Signal was from something else (e.g. stale) — loop again
      }

      // Check pane is still alive
      if (!(await paneAlive(target))) {
        await resetState();
        return { output: "Tmux pane was closed during execution.", exitCode: 1 };
      }
    }

    if (!completed) {
      await tmuxExec("send-keys", "-t", target, "C-c");
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

      while (!signal.aborted && paneReady) {
        if (agentRunning) {
          await sleep(250);
          continue;
        }

        // Block until next prompt signal (zero CPU)
        const signaled = await waitForPrompt(30000);
        if (signal.aborted || !paneReady) break;
        if (agentRunning) continue;  // agent triggered the signal, not the user

        if (!signaled) {
          // Timeout — check pane is alive, then loop
          if (!(await paneAlive(target))) { await resetState(); break; }
          continue;
        }

        // A prompt appeared — check if this is user activity (not agent)
        if (agentRunning) continue;

        try {
          const dbg = (msg: string) => {
            try { writeFileSync("/tmp/pi-mirror-debug.log", `${new Date().toISOString()} ${msg}\n`, { flag: "a" }); } catch {}
          };

          dbg(`signaled, agentRunning=${agentRunning}, promptSymbol=${JSON.stringify(promptSymbol)}, promptHeight=${promptHeight}`);

          const current = (await capturePane(200)).trim();
          if (current === lastSnapshot) {
            dbg(`skip: same snapshot (len=${current.length}, last3lines=${JSON.stringify(current.split("\n").slice(-3))})`);
            continue;
          }

          const bLines = lastSnapshot.split("\n");
          const aLines = current.split("\n");
          let i = 0;
          while (i < bLines.length && i < aLines.length && bLines[i] === aLines[i]) i++;
          const diff = aLines.slice(i).join("\n").trim();

          lastSnapshot = current;
          if (diff.length < 5) { dbg(`skip: diff too short (${diff.length}): ${JSON.stringify(diff)}`); continue; }

          dbg(`diff (${diff.length} chars): ${JSON.stringify(diff.slice(0, 500))}`);

          const { rc } = await readRc();
          const message = await formatActivity(diff, rc);
          dbg(`formatActivity result: ${JSON.stringify(message?.slice(0, 300) ?? null)}`);
          if (!message) continue;

          pi.sendMessage(
            {
              customType: "tmux-activity",
              content: `User activity in the shared terminal:\n\n${message}`,
              display: true,
            },
            { deliverAs: "followUp", triggerTurn: false },
          );

          // Wait for agent to finish, then check for missed activity.
          // Signals sent during agent execution are lost (nobody listening),
          // so we must actively check instead of waiting for the next signal.
          while (agentRunning && !signal.aborted) await sleep(500);
          if (signal.aborted || !paneReady) break;

          // The bash tool updates lastSnapshot after each agent command,
          // so any diff here is purely user activity that happened during
          // the agent's turn.
          const postAgent = (await capturePane(200)).trim();
          if (postAgent !== lastSnapshot) {
            const pb = lastSnapshot.split("\n");
            const pa = postAgent.split("\n");
            let pi2 = 0;
            while (pi2 < pb.length && pi2 < pa.length && pb[pi2] === pa[pi2]) pi2++;
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
    // Unblock any pending wait-for by sending a signal
    tmuxExec("wait-for", "-S", WAIT_CHANNEL).catch(() => {});
  }

  // ── bash tool override ───────────────────────────────────

  pi.registerTool({
    name: "bash",
    label: "Bash (tmux)",
    description:
      "Execute a bash command in a shared tmux terminal. The terminal is " +
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
          return {
            content: [{ type: "text", text: "Error: could not create tmux pane. Are you inside tmux?" }],
            details: { command: params.command, exitCode: 1, cwd: ctx.cwd },
            isError: true,
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: `Running in tmux → ${target}…` }],
        });

        const ms = params.timeout ? params.timeout * 1000 : undefined;
        const { output, exitCode } = await runInTmux(params.command, ctx.cwd, ms, signal);

        if (paneReady) {
          lastSnapshot = (await capturePane(200)).trim();
        }

        // Refresh diff viewer after each command
        refreshDiff().catch(() => {});

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
          content: [{ type: "text", text: `tmux-mirror error: ${err instanceof Error ? err.message : String(err)}` }],
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
      "Read recent content from the shared tmux terminal. Shows output " +
      "from both agent and user commands.",
    parameters: Type.Object({
      lines: Type.Optional(
        Type.Number({ description: "Lines of scrollback (default: 200)" }),
      ),
    }),
    async execute(_id, params) {
      if (!(await ensurePane())) {
        return {
          content: [{ type: "text", text: "Error: tmux pane not available" }],
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
    // Don't update lastSnapshot here — let the activity loop diff first
    // to catch commands the user typed during the agent's turn.
    // The bash tool already updates lastSnapshot after each command.

    // Refresh diff viewer — catches changes from Edit/Write tools too.
    refreshDiff().catch(() => {});
  });

  pi.on("session_start", async (_event, ctx) => {
    const ok = await ensurePane();
    if (ok) {
      await installHook();
      lastSnapshot = (await capturePane(200)).trim();
      startActivityLoop();
      await ensureDiffPane();
      await refreshDiff();
      ctx.ui.notify(`Shared tmux pane → ${target}`, "info");
    }
  });

  pi.on("session_shutdown", () => stopActivityLoop());
}
