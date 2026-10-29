# coding-agents

Opinionated Nix packages and Home Manager modules for AI coding agents.
All agents and aliases are configured with yolo mode by default. (e.g. `--dangerously-skip-permissions`)

## Packages

| Package            | Description                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| **aichat**         | [AIChat](https://github.com/sigoden/aichat) — All-in-one LLM CLI tool                                           |
| **claude-code**    | [Claude Code](https://github.com/anthropics/claude-code) — Anthropic's CLI coding agent                         |
| **claude-code-ui** | [Claude Code UI](https://github.com/siteboon/claudecodeui) — Web UI for Claude Code                             |
| **codex**          | [Codex](https://github.com/openai/codex) — OpenAI's CLI coding agent                                            |
| **crush**          | [Crush](https://github.com/charmbracelet/crush) — Charm's glamorous terminal coding agent                       |
| **gemini-cli**     | [Gemini CLI](https://github.com/google-gemini/gemini-cli) — Google's CLI coding agent                           |
| **hermes-agent**   | [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Nous Research's self-improving AI agent          |
| **llmfit**         | [llmfit](https://github.com/AlexsJones/llmfit) — Right-size LLM models to your system hardware                  |
| **llmserve**       | [llmserve](https://github.com/AlexsJones/llmserve) — TUI for serving local LLM models                           |
| **openclaude**     | [OpenClaude](https://github.com/Gitlawb/openclaude) — Coding-agent CLI for cloud and local model providers      |
| **pi**             | [Pi](https://github.com/earendil-works/pi) — The minimal coding agent with extensions, skills, and TUI          |
| **vibe-kanban**    | [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) — Kanban-style orchestration surface for AI coding agents |
| **whichllm**       | [whichllm](https://github.com/Andyyyy64/whichllm) — Find the best local LLM that runs on your hardware          |
| **ccusage**        | [ccusage](https://www.npmjs.com/package/ccusage) — Track Claude Code token usage and costs                      |

Packages are automatically updated every hour via GitHub Actions.

Supported flake systems are `x86_64-linux` and `aarch64-darwin`. `llmfit`,
`llmserve`, `playwright-cli`, and `vibe-kanban` are currently Linux-only.

`playwright-cli` uses Chrome in headless mode by default. Set
`PLAYWRIGHT_MCP_HEADLESS=false` to override the wrapper default.

On Linux, `claude-code` bundles the runtime dependencies for `/voice`: the
ALSA library, `arecord`, and SoX (`sox`/`rec`) with PulseAudio support, including
WSLg audio. No separate audio-package installation is needed. The Linux wrapper
disables Claude's self-updater so updates stay managed by Nix and retain these
dependencies. A working host microphone/audio server and a Claude account
eligible for voice mode are still required.

`pi` uses the official Pi flake's `stable` branch, pinned in
`flake.lock`, with upstream's source build and runtime dependencies on `PATH`.
A local override disables telemetry (`PI_TELEMETRY=0`) and adds the fetch
extension's dependencies to `NODE_PATH`. Update Pi with
`just update-pi`; no local Pi npm lockfile or dependency hash is
needed. Pi retains its upstream nixpkgs inputs rather than following this
flake's nixpkgs.

## Skills

[Agent Skills](https://agentskills.io) get installed into each agent's config
directory, so every agent has access to the same domain knowledge.

| Skill                     | Description                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **devenv**                | Setting up [devenv.sh](https://devenv.sh) development environments — Python/uv, services (Postgres, Redis), Django projects, and Nix packages |
| **compone**               | Building Python components with the [compone](https://github.com/kissgyorgy/compone) framework for type-safe HTML/XML/RSS generation          |
| **hn-sentiment-analysis** | Manual Hacker News thread sentiment analysis from a provided HN URL, with Algolia download and preparation scripts                            |

## Installation

The package overlay and combined Home Manager module can also be imported
without using this directory as a flake:

```nix
# Supply the upstream Hermes and Pi flake inputs to the overlay.
import ./coding-agents/overlay.nix { inherit hermes-agent pi; }

# In a Home Manager module:
imports = [ ./coding-agents/home-manager ];
```

### Flake packages (ad-hoc usage)

Run any package directly:

```bash
nix run github:kissgyorgy/coding-agents#aichat
nix run github:kissgyorgy/coding-agents#claude-code
nix run github:kissgyorgy/coding-agents#codex
nix run github:kissgyorgy/coding-agents#crush
nix run github:kissgyorgy/coding-agents#gemini-cli
nix run github:kissgyorgy/coding-agents#hermes-agent
nix run github:kissgyorgy/coding-agents#openclaude
nix run github:kissgyorgy/coding-agents#pi
nix run github:kissgyorgy/coding-agents#vibe-kanban
nix run github:kissgyorgy/coding-agents#whichllm
```

### Home Manager module

Add the flake input:

```nix
# flake.nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    home-manager.url = "github:nix-community/home-manager";
    coding-agents.url = "github:kissgyorgy/coding-agents";
  };
}
```

Import the module and apply the overlay:

```nix
# In your Home Manager configuration
{ inputs, ... }:
{
  imports = [ inputs.coding-agents.homeManagerModules.default ];

  nixpkgs.overlays = [ inputs.coding-agents.overlays.default ];

  coding-agents = {
    claude-code.enable = true;
    codex.enable = true;
    crush.enable = true;
    gemini-cli.enable = true;
    hermes-agent.enable = true;
    pi.enable = true;
  };
}
```

### Options

#### `coding-agents.skillsDir`

Path to a custom skills directory shared by all agents. Defaults to the built-in skills.
This directory will be symlinked to every agent specific skills directory if specified.

```nix
coding-agents.skillsDir = ./my-skills;
```

#### `coding-agents.claude-code`

- **`enable`** — Install Claude Code, ccusage, and configure shell aliases (`claude`, `claude-api`)
- **`claudeMdPath`** — Path to a custom `CLAUDE.md` file (defaults to the built-in one)

Claude Code is configured with pre-approved tool permissions, a command
validator hook, an auto-formatter hook on file writes, and 1Password API key
integration.

#### `coding-agents.codex`

- **`enable`** — Install Codex and link shared skills

#### `coding-agents.crush`

- **`enable`** — Install Crush, link shared skills, configure `crush.json` with
  allowed tool permissions, LSPs (gopls, typescript-language-server, nil, pyright),
  disabled attribution, and add a `crush` shell alias (runs with `-y` yolo mode)

#### `coding-agents.gemini-cli`

- **`enable`** — Install Gemini CLI and add a `gemini` shell alias (runs with `--yolo --model pro`)

#### `coding-agents.hermes-agent`

- **`enable`** — Install Hermes Agent

#### `coding-agents.pi`

- **`enable`** — Install Pi, ImageMagick, `nil`, `basedpyright`, `typescript-language-server`, `typescript`, `gopls`, `go`, and link shared skills and extensions
- **`extensionsDir`** — Path to a custom extensions directory
  (defaults to built-in extensions including tmux-mirror, plan-mode, and more)

The built-in `lmstudio` extension discovers available chat models from LM Studio
at `http://127.0.0.1:1234` whenever `/model` refreshes, without model entries in
`models.json`. Use `/login lmstudio` to save a server URL and optional API key in
Pi's `auth.json`; the connection is validated before saving. Server URLs may
include or omit `/v1`. Saved settings take precedence over `LMSTUDIO_BASE_URL`
and `LMSTUDIO_API_KEY`, and apply to both discovery and inference. Leaving the
key blank explicitly selects keyless access. Selecting LM Studio in `/logout`
removes the saved connection and restores environment settings or the keyless
localhost default. It reads context sizes and vision support from LM Studio's native
`/api/v1/models` catalog and excludes embedding models. Run `/reload` to activate
it through the live extensions symlink.

The built-in extensions directory includes vendored
[`pi-openai-usage`](https://github.com/studioarray/pi-openai-usage) 0.1.4, which
shows OpenAI Codex subscription usage in the status line. Pi discovers it
without a launcher flag or `pi install`. It uses your existing OpenAI Codex OAuth
login and provides `/openai-usage-settings`. Run `/reload` to load it when using
the live extensions-directory symlink. Source provenance and the upstream MIT
license are retained in `home-manager/pi-coding-agent/extensions/pi-openai-usage/`.
