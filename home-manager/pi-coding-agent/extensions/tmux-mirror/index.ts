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
 * Usage:
 *   pi --mirror
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
import { writeFileSync } from "node:fs";

import type { MirrorBackend } from "./types.js";
import { sq, sleep } from "./types.js";
import { TmuxBackend } from "./tmux.js";
import { KittyBackend } from "./kitty.js";

export default function (pi: ExtensionAPI) {
  // ── CLI flag (registered before anything else) ───────────
  // Flags aren't available at init time, so everything else
  // is deferred to session_start where getFlag works.

  pi.registerFlag("mirror", {
    description: "Run commands in a shared terminal split (tmux/kitty)",
    type: "boolean",
    default: false,
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!pi.getFlag("mirror")) return;

    // ── shared state ───────────────────────────────────────

    let hookInstalled = false;
    let promptHeight = 2;
    let promptSymbol = "$ ";
    let agentRunning = false;
    let activityLoopRunning = false;
    let activityAbort: AbortController | null = null;
    let lastSnapshot = "";

    // Callback invoked by backends when state is reset (pane lost/recreated)
    const onBackendReset = () => {
      hookInstalled = false;
    };

    // ── backend detection & creation ───────────────────────

    let backend: MirrorBackend;
    const exec = pi.exec.bind(pi);

    if (process.env.TMUX) {
      backend = new TmuxBackend(exec, onBackendReset);
    } else if (process.env.KITTY_PID) {
      backend = new KittyBackend(exec, onBackendReset);
    } else {
      ctx.ui.notify("--mirror requires tmux or kitty", "error");
      return;
    }

    // ── shell hook ─────────────────────────────────────────

    async function installHook(): Promise<boolean> {
      if (hookInstalled) return true;

      const shell = await backend.getShellName();
      const hook = backend.generateHookCode(shell);

      for (let attempt = 0; attempt < 3; attempt++) {
        await backend.prepareForHook();

        await backend.sendText(` ${hook} && clear`);
        await backend.sendEnter();

        const signaled = await backend.waitForPrompt(5000);
        const { seq } = await backend.readRc();
        const hookFired = seq > 0 || signaled;

        if (hookFired) {
          await sleep(500);
          const pane = (await backend.capturePane(50)).trimEnd();
          const paneLines = pane.split("\n");
          let h = 0;
          for (let i = paneLines.length - 1; i >= 0; i--) {
            if (paneLines[i].trim()) h++;
            else break;
          }
          promptHeight = Math.max(1, h);
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

    // ── output extraction ──────────────────────────────────

    function isPromptLine(line: string): boolean {
      return line.trim().startsWith(promptSymbol);
    }

    function extractCommand(line: string): string {
      let cmd = line.trim().slice(promptSymbol.length).trim();
      cmd = cmd.replace(/\s*\[[\d:]+\]\s*$/, "").trim();
      return cmd;
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

      const cwd = await backend.getPaneCwd();
      const home = process.env.HOME || "";
      const shortCwd =
        home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

      let result = `${shortCwd} $ ${lastCmd}`;
      if (out.length) result += `\n${out.join("\n")}`;
      result += `\n[exit code: ${exitCode}]`;
      return result;
    }

    // ── run a command in the pane ──────────────────────────

    async function resetAll(): Promise<void> {
      hookInstalled = false;
      await backend.resetState();
    }

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

      const before = await backend.capturePane();
      const { seq: seqBefore } = await backend.readRc();

      const paneCwd = await backend.getPaneCwd();
      const needsCd = paneCwd !== cwd;
      let sendCmd = needsCd ? `cd ${sq(cwd)} && ${command}` : command;

      if (sendCmd.includes("\n")) {
        sendCmd = `{\n${sendCmd}\n}`;
      }

      await backend.sendText(` ${sendCmd}`);
      await backend.sendEnter();

      const timeout = timeoutMs || 120_000;
      const deadline = Date.now() + timeout;
      let exitCode = 0;
      let completed = false;

      while (Date.now() < deadline) {
        if (signal?.aborted) {
          await backend.sendCtrlC();
          return { output: "Cancelled", exitCode: 130 };
        }

        const remaining = Math.min(deadline - Date.now(), 5000);
        if (remaining <= 0) break;

        const signaled = await backend.waitForPrompt(remaining);

        if (signaled) {
          const { seq, rc } = await backend.readRc();
          if (seq > seqBefore) {
            exitCode = rc;
            completed = true;
            break;
          }
        }

        if (!(await backend.paneAlive())) {
          await resetAll();
          return {
            output: "Terminal pane was closed during execution.",
            exitCode: 1,
          };
        }
      }

      if (!completed) {
        await backend.sendCtrlC();
        await sleep(500);
      }

      await sleep(200);
      const after = await backend.capturePane();
      let output = extractOutput(before, after);

      if (!completed) output += "\n[command timed out]";
      return { output, exitCode: completed ? exitCode : 124 };
    }

    // ── user activity detection ────────────────────────────

    function startActivityLoop() {
      if (activityLoopRunning || !backend.isPaneReady()) return;
      activityLoopRunning = true;
      activityAbort = new AbortController();

      (async () => {
        const { signal } = activityAbort!;
        let lastSeenSeq = (await backend.readRc()).seq;

        while (!signal.aborted && backend.isPaneReady()) {
          if (agentRunning) {
            await sleep(250);
            lastSeenSeq = (await backend.readRc()).seq;
            continue;
          }

          // Block until a command completes (zero CPU for both backends)
          const signaled = await backend.waitForPrompt(30000);
          if (signal.aborted || !backend.isPaneReady()) break;
          if (agentRunning) continue;
          if (!signaled) {
            if (!(await backend.paneAlive())) {
              await resetAll();
              break;
            }
            continue;
          }

          // Verify a new command actually completed (filters stale FIFO signals)
          const { seq: currentSeq } = await backend.readRc();
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

            const current = (await backend.capturePane(200)).trim();
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

            const { rc } = await backend.readRc();
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
            if (signal.aborted || !backend.isPaneReady()) break;

            const postAgent = (await backend.capturePane(200)).trim();
            if (postAgent !== lastSnapshot) {
              const pb = lastSnapshot.split("\n");
              const pa = postAgent.split("\n");
              let pi2 = 0;
              while (pi2 < pb.length && pi2 < pa.length && pb[pi2] === pa[pi2])
                pi2++;
              const postDiff = pa.slice(pi2).join("\n").trim();

              if (postDiff.length >= 5) {
                const { rc: postRc } = await backend.readRc();
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
            lastSnapshot = (await backend.capturePane(200)).trim();
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
      backend.unblockWait().catch(() => {});
    }

    // ── register tools ─────────────────────────────────────

    pi.registerTool({
      name: "bash",
      label: `Bash (${backend.label})`,
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
          if (!(await backend.ensurePane())) {
            const hint =
              backend.label === "tmux"
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

          onUpdate?.({
            content: [
              {
                type: "text",
                text: `Running in ${backend.label} → ${backend.displayTarget()}…`,
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

          if (backend.isPaneReady()) {
            lastSnapshot = (await backend.capturePane(200)).trim();
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
          await resetAll();
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
        if (!(await backend.ensurePane())) {
          return {
            content: [
              { type: "text", text: "Error: terminal pane not available" },
            ],
            isError: true,
          };
        }
        const text = (await backend.capturePane(params.lines || 200)).trim();
        return {
          content: [{ type: "text", text: text || "(terminal is empty)" }],
          details: {},
        };
      },
    });

    // ── register event handlers ────────────────────────────

    pi.on("agent_start", () => {
      agentRunning = true;
    });

    pi.on("agent_end", () => {
      agentRunning = false;
    });

    pi.on("session_shutdown", () => {
      stopActivityLoop();
      backend.cleanup();
    });

    // ── activate: set up pane, hook, activity loop ─────────

    const ok = await backend.ensurePane();
    if (ok) {
      await installHook();
      lastSnapshot = (await backend.capturePane(200)).trim();
      startActivityLoop();
      ctx.ui.notify(
        `Shared ${backend.label} pane → ${backend.displayTarget()}`,
        "info",
      );
    }
  });
}
