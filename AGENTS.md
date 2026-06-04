# Overview

This is a Nix flake that provides opinionated packages and Home Manager modules
for AI coding agents (Claude Code, Codex, Gemini CLI, Pi, Crush, llmfit,
llmserve, ccusage, Claude Code UI, Vibe Kanban). All agents are configured with yolo/auto-approve mode by
default. Shared "skills" (domain knowledge documents) are distributed to every
agent.

## Commands

```bash
# Discover all available commands
just --list

# Build all packages
just build

# Build specific packages
just build claude-code codex

# Build a single package
nix build .#claude-code

# Check current package version
nix eval --raw .#claude-code.version
```

Note: `just build` defaults to a subset of packages. To build packages not in
that list (e.g. `playwright-cli`, `vibe-kanban`), use `nix build .#<name>`.

## Architecture

### Nix Flake Structure

**`flake.nix`** — Entry point. Defines:

- An **overlay** that adds all packages to nixpkgs (each calls `callPackage` on `packages/<name>.nix`)
- **`packages.x86_64-linux`** — Exposes the packages for direct `nix build`/`nix run`
- **`homeManagerModules`** — Per-agent Home Manager modules plus a `default` that imports all of them and defines the shared `coding-agents.skillsDir` option

### Packages (`packages/`)

Each `.nix` file is a standalone Nix derivation that downloads a pre-built binary or npm bundle from upstream releases and patches it for NixOS. Packaging patterns used:

- **Binary ELF patching**: `claude-code.nix`, `pi-coding-agent/` — download a single binary, `patchelf` the interpreter
- **autoPatchelfHook**: `codex.nix` — automatic shared library resolution
- **Rust builds**: `llmfit.nix`, `llmserve.nix` — build from source with `rustPlatform.buildRustPackage`
- **Node.js wrapper**: `gemini-cli.nix`, `ccusage.nix` — download a JS bundle, wrap with `makeBinaryWrapper` pointing to `nodejs_22`
- **buildNpmPackage**: `claude-code-ui.nix` — full npm build from source
- **AppImage**: `emdash.nix` — extract and wrap AppImage with Wayland flags

`pi-coding-agent/` is a subdirectory (not a single `.nix` file) because it also
ships a `models.generated.ts` file updated from upstream.

Some packages exist in `packages/` but are not yet wired into `flake.nix`
(e.g. `emdash.nix`, `pi-agent/`).

When updating a package, change `version` and `hash` in the corresponding file (or use `nix-update`).

### Home Manager Modules (`home-manager/`)

Each agent has a subdirectory with a `default.nix` that:

1. Defines `coding-agents.<agent>.enable` (and agent-specific options)
2. Installs the package and any companions
3. Links shared skills from `skills/` into the agent's config directory
4. Optionally supports a `skillsDir` symlink override for live editing

**Claude Code** (`home-manager/claude-code/`) is the most complex module:

- `settings.nix` — Claude Code settings as a Nix attrset (permissions, env vars, hooks config, teammate mode)
- `CLAUDE.md` — Global system prompt shipped to `~/.claude/CLAUDE.md`
- `command-validator.py` — PreToolUse hook that validates Bash commands (blocks `find -exec`, `rm -rf`, etc.)
- `format-file` — PostToolUse hook that auto-formats edited files based on extension (ruff for Python, prettier for YAML, shfmt for shell, nixpkgs-fmt for Nix)
- `statusline.sh` — Status line showing hostname, model, estimated tokens, session duration, and path
- Shell aliases: `claude` (interactive with Max subscription) and `claude-api` (with 1Password API key)

**Crush** (`home-manager/crush/`) — also has a `settings.nix` for configuring allowed tool permissions, LSPs, and behavior.

**Pi** (`home-manager/pi-coding-agent/`) — includes:

- `extensions/` — Custom Pi extensions (plan-mode, tmux-mirror, web-search, explorer-mode, post-edit, etc.)
- `prompts/` — Custom prompt templates (e.g. `init.md`)
- CRITICAL: `home-manager/pi-coding-agent/extensions` is symlinked to `~/.pi/agent/extensions`. Editing either path edits the same files in this repo.

### Skills (`skills/`)

Shared domain knowledge documents installed into every agent's skills directory.
Each skill has a `SKILL.md` entry point and supporting markdown files.

### Automatic Updates (`.github/workflows/update.yml`)

Runs 3× daily via cron. Executes `just update` which checks GitHub releases for
newer versions, updates package files with `nix-update`, commits, pushes, and
pushes built results to a Cachix binary cache.

### Global Agent Instructions (`home-manager/global-agents.md`)

A shared instructions file deployed as the top-level agent prompt for Claude Code (`~/.claude/CLAUDE.md`), Codex (`~/.codex/AGENTS.md`), and Gemini CLI (`~/.gemini/GEMINI.md`). Controlled via `coding-agents.agentsMdPath` option.

### Notes

- If you update or add a package, don't forget to update README.md too!
- CRITICAL: `home-manager/pi-coding-agent/extensions` and `~/.pi/agent/extensions` are the same files via symlink. If you edit Pi extensions through `~/.pi/agent/extensions`, you are editing this repo.
- `packages/pi-agent/` and `packages/emdash.nix` exist but are not wired into `flake.nix`.
- `vibe-kanban` and `playwright-cli` are packages only (no Home Manager module).
