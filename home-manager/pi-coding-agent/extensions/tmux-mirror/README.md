# tmux-mirror

A [pi-coding-agent](https://github.com/nichochar/pi-coding-agent) extension
that redirects all agent commands to a shared tmux split pane, giving both the
agent and the user full bidirectional visibility of the same terminal.

## Features

- **Shared terminal** — agent commands run in a visible tmux split pane instead
  of a hidden subprocess. The user sees every command as it executes.
- **Bidirectional** — when the user types commands in the pane, the agent is
  notified instantly and can respond to the output.
- **Clean command display** — the actual command text is sent to the shell via
  `tmux send-keys`. No wrapper scripts, markers, or temp file execution visible
  in the terminal.
- **Exit code tracking** — a shell hook (`precmd` for zsh, `PROMPT_COMMAND` for
  bash) atomically writes a sequence number + exit code to a temp file after
  every command.
- **Instant detection** — uses `tmux wait-for` for zero-CPU event-driven
  notifications instead of polling. Both command completion (agent) and user
  activity detection block on `wait-for` with no busy loops.
- **Prompt-aware output parsing** — auto-detects the user's prompt symbol and
  height from the pane after `clear`. Uses this to cleanly extract command
  output, stripping prompt lines and RPROMPT timestamps. The same parsing logic
  is used for both agent commands and user activity.
- **Pane lifecycle management** — auto-creates a horizontal split pane on
  startup. Recovers if the user closes the pane. Reuses existing panes across
  agent restarts via a saved pane ID file.
- **Multi-line commands** — commands with newlines are wrapped in `{ ... }` to
  form a single compound command. This ensures `precmd` fires only once (after
  all commands complete), not after each line. Works with heredocs, quoted
  strings, and nested constructs.
- **Smart `cd`** — only prepends `cd <dir> &&` when the pane's working directory
  differs from the agent's.
- **Pager disabled** — sets `PAGER=cat GIT_PAGER=cat` so commands like
  `git log` don't block the terminal.

## How It Works

### Architecture

```
┌─────────────────────┐  ┌──────────────────────┐
│  pi (agent pane)    │  │  shared pane (%N)     │
│                     │  │                       │
│  tmux-mirror ext    │──│  zsh/bash + hook      │
│  ├─ bash tool       │  │  ├─ precmd writes RC  │
│  ├─ read_terminal   │  │  └─ wait-for -S       │
│  └─ activity loop   │  │                       │
└─────────────────────┘  └──────────────────────┘
         │                          │
         └── tmux wait-for ─────────┘  (event-driven, zero CPU)
```

### Shell Hook

On startup the extension sends the hook code inline via `tmux send-keys` to the
pane's shell. The hook:

1. Registers a `precmd` function (zsh) or `PROMPT_COMMAND` (bash).
2. On every prompt: stores `<seq> <exit_code>` in a tmux session environment
   variable (`PI_LAST_RC`) via `tmux set-environment`.
3. Signals `tmux wait-for -S pi-prompt` to wake any blocked waiters.

This provides instant, invisible notification that a command has completed,
along with its exit code.

### Prompt Detection

After the hook is installed and the pane is cleared, the extension captures the
rendered prompt and detects:

- **`promptHeight`** — number of non-empty trailing lines (typically 2 for a
  two-line prompt with info bar + input line).
- **`promptSymbol`** — the first non-space token on the last line (e.g., `❯`,
  `$`, `#`). Used to identify prompt lines in captured output.

These are used by both `extractOutput` (agent commands) and `formatActivity`
(user commands) to strip prompt decoration and extract clean command output.

### Agent Commands (`bash` tool)

1. Capture the pane state (`before`).
2. Send the command text via `tmux send-keys`.
3. Block on `tmux wait-for pi-prompt` until precmd fires.
4. Read exit code from the RC file.
5. Capture the pane state (`after`).
6. Diff `before`/`after`, find the last prompt line with command text, collect
   output lines until the next prompt block.

### User Activity Detection

A background async loop blocks on `tmux wait-for pi-prompt`. When signaled
(and the agent is idle):

1. Capture the pane and diff against the last snapshot.
2. Parse the diff using the same prompt-aware logic: find the last command,
   collect output, read exit code.
3. Format as `~/dir $ command\noutput\n[exit code: N]`.
4. Inject into the conversation via `pi.sendMessage` with `triggerTurn: true`.

### Pane Recovery

On every `bash` call, `ensurePane()` checks if the target pane is still alive
via `tmux list-panes` (never targets a potentially dead pane directly). If the
pane was closed:

1. Reset all state (paneReady, hookInstalled, RC files).
2. Wait 500ms for terminal resize to settle.
3. Create a new split pane.
4. Wait for a shell to start (polls `pane_current_command` for up to 10s).
5. Reinstall the hook.

The pane ID is saved in the tmux session environment (`PI_MIRROR_PANE`) so it
can be reused across agent restarts without creating duplicate panes.

## Tools

### `bash` (overrides built-in)

Executes a command in the shared tmux pane.

| Parameter | Type     | Description                          |
|-----------|----------|--------------------------------------|
| `command` | `string` | Bash command to execute              |
| `timeout` | `number` | Timeout in seconds (default: 120)    |

### `read_terminal`

Reads recent content from the shared tmux pane scrollback.

| Parameter | Type     | Description                          |
|-----------|----------|--------------------------------------|
| `lines`   | `number` | Lines of scrollback (default: 200)   |

## Configuration

| Environment Variable   | Description                                    |
|------------------------|------------------------------------------------|
| `TMUX_MIRROR_TARGET`   | Explicit tmux pane target (default: auto-split) |

## Requirements

- Must run pi inside a tmux session.
- The shell in the split pane must be zsh or bash.

## Tmux Session State

All persistent state is stored in tmux session environment variables, not temp
files. This keeps the filesystem clean and scopes state to the tmux session.

| Variable          | Purpose                                     |
|-------------------|---------------------------------------------|
| `PI_MIRROR_PANE`  | Pane ID for cross-restart reuse             |
| `PI_LAST_RC`      | `<seq> <exit_code>` written by precmd hook  |

Debug log: `/tmp/pi-mirror-debug.log` (activity loop, temporary).

## Implementation Notes

### Why `tmux wait-for` instead of polling?

The original implementation polled the RC file every 300ms to detect command
completion, and used a 3-second `setInterval` for user activity. This was
replaced with `tmux wait-for` which blocks the process with zero CPU until
signaled. Both the agent command wait loop and the user activity loop use this
mechanism. Detection is instant rather than delayed by a polling interval.

### Why `capture-pane -J`?

Without `-J`, tmux wraps long lines at the pane width, producing multiple
physical lines per logical line. The user's prompt (with RPROMPT timestamp
padding) would appear as two lines in the capture, causing the parser to see
duplicate commands. `-J` joins wrapped lines back into logical lines.

### Why detect prompt from the pane instead of reading PS1?

`PS1`/`PROMPT` contain unexpanded escape sequences (`%~`, `%F{blue}`, etc.)
that are useless for matching rendered output. Instead, the extension captures
the pane after `clear` and reads the actual rendered prompt. A 500ms delay
after the `wait-for` signal ensures the prompt has finished drawing (since
`precmd` fires before the prompt is rendered).

### Why save the pane ID in tmux session environment?

Originally the pane was tagged via `tmux select-pane -T "pi-mirror"` and found
by title. But the user's shell prompt theme overwrites the pane title on every
prompt redraw, so the tag was lost. A tmux session environment variable
(`PI_MIRROR_PANE`) is scoped to the session, survives agent restarts, and
doesn't leave temp files on the filesystem.

### Why wrap multi-line commands in `{ ... }`?

When multiple commands separated by newlines are sent via `send-keys`, each
newline triggers Enter. The shell executes each command separately, and
`precmd` fires after each one. The agent's `wait-for` catches the first signal
and thinks the entire command is done, while remaining commands are still in the
shell's input buffer. Wrapping in `{ ... }` creates a compound command — the
shell enters continuation mode on `{`, executes all commands when `}` is
reached, and `precmd` fires only once at the end.

An earlier approach used backslash (`\`) continuation, but this corrupted
multi-line string content (e.g., commit messages with newlines) because the `\`
appeared literally inside quoted strings.

### Why report only the last command in user activity?

The diff between snapshots can contain multiple commands if the user typed
several between checks. The exit code in the RC file only corresponds to the
last command. Reporting all commands would show stale exit codes for earlier
ones. Additionally, zsh autosuggestions or history recall can cause the same
command text to appear on the new prompt line, creating false duplicates.
