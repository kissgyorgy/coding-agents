/**
 * Shared types and utilities for the tmux-mirror extension backends.
 */

export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
) => Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
  killed?: boolean;
}>;

/**
 * Backend interface for terminal multiplexer integrations.
 * Implemented by TmuxBackend and KittyBackend.
 */
export interface MirrorBackend {
  readonly label: string;

  /** Create or reuse a terminal pane. Returns true if pane is ready. */
  ensurePane(): Promise<boolean>;

  /** Check if the current pane is still alive. */
  paneAlive(): Promise<boolean>;

  /** Whether the pane is ready for commands. */
  isPaneReady(): boolean;

  /**
   * Reset backend-specific state (pane lost).
   * Also invokes the onReset callback to reset shared state (e.g. hookInstalled).
   */
  resetState(): Promise<void>;

  /** Human-readable pane identifier for display. */
  displayTarget(): string;

  /** Capture terminal content (scrollback). */
  capturePane(lines?: number): Promise<string>;

  /** Get the pane's current working directory. */
  getPaneCwd(): Promise<string>;

  /** Send literal text to the pane (no Enter). */
  sendText(text: string): Promise<void>;

  /** Send Enter key to the pane. */
  sendEnter(): Promise<void>;

  /** Send Ctrl+C to the pane. */
  sendCtrlC(): Promise<void>;

  /** Get the shell name running in the pane. */
  getShellName(): Promise<string>;

  /**
   * Generate the shell hook code for the given shell.
   * Includes env setup, seq tracking, and precmd/PROMPT_COMMAND registration.
   */
  generateHookCode(shell: string): string;

  /** Clear RC state and prepare for hook installation (e.g. recreate FIFO). */
  prepareForHook(): Promise<void>;

  /** Read the current sequence number and exit code. */
  readRc(): Promise<{ seq: number; rc: number }>;

  /** Block until the shell signals prompt ready. Returns true if signaled. */
  waitForPrompt(timeoutMs: number): Promise<boolean>;

  /** Unblock a pending waitForPrompt (used when stopping the activity loop). */
  unblockWait(): Promise<void>;

  /** Clean up temp files etc. on shutdown. */
  cleanup(): void;
}

/** Shell-quote a string with single quotes. */
export const sq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/** Promise-based sleep. */
export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));
