# Overview

Add Crush (charmbracelet/crush) as a new coding agent: Nix package, Home Manager module with full config (skills, global `crush.json` with LSPs, permissions, attribution), shell alias, and integration into the flake + Justfile update pipeline.

# Architecture

Follow the existing agent pattern: standalone package in `packages/crush.nix` using `autoPatchelfHook` for the dynamically linked Go binary, Home Manager module in `home-manager/crush/` that links shared skills to `~/.config/crush/skills/`, installs a `crush.json` with full settings, and wires up a yolo-mode shell alias. The flake overlay, packages, homeManagerModules, Justfile build/update lists all get the new entry.

# Implementation plan

## Package (`packages/crush.nix`)

Use `autoPatchelfHook` pattern (like `codex.nix`). Crush ships as a tarball with a single binary, shell completions, and manpages.

- Source URL: `https://github.com/charmbracelet/crush/releases/download/v${version}/crush_${version}_Linux_x86_64.tar.gz`
- Version: `0.43.1`
- Hash: `sha256-FTViaVgoHm4Y2K+Pr9JxQ18QPZIk86sZ5z7bK1EeuSA=`
- `sourceRoot = "crush_${version}_Linux_x86_64"`
- Install binary to `$out/bin/crush`
- Install shell completions (bash, fish, zsh) and manpage
- License: `licenses.unfree` (FSL-1.1-MIT)
- Only needs glibc as `buildInputs`

## Home Manager module (`home-manager/crush/default.nix`)

Pattern follows `pi-coding-agent` and `claude-code`:

```nix
options.coding-agents.crush = {
  enable = lib.mkEnableOption "Crush coding agent";
};
```

Config when enabled:
- `home.packages = [ pkgs.crush ]`
- `home.file.".config/crush/skills".source` — linked to shared `../../skills` (or `skillsDir` symlink)
- `home.file.".config/crush/crush.json".text` — JSON settings (generated from Nix attrset via `builtins.toJSON`)
- `programs.zsh.shellAliases.crush` — `"${pkgs.crush}/bin/crush -y"` (yolo mode)

## Settings (`home-manager/crush/settings.nix`)

Nix attrset that becomes `crush.json`:

```nix
{
  "$schema" = "https://charm.land/crush.json";

  permissions.allowed_tools = [
    "view" "ls" "grep" "edit" "write" "bash" "glob" "fetch"
  ];

  lsp = {
    go = { command = "gopls"; };
    typescript = { command = "typescript-language-server"; args = ["--stdio"]; };
    nix = { command = "nil"; };
    python = { command = "pyright-langserver"; args = ["--stdio"]; };
  };

  options = {
    attribution = {
      trailer_style = "none";
      generated_with = false;
    };
  };
}
```

## Flake integration (`flake.nix`)

Three changes:
1. **Overlay**: add `crush = final.callPackage ./packages/crush.nix { };`
2. **packages.x86_64-linux**: add `crush` to the inherit list
3. **homeManagerModules**: add `crush = import ./home-manager/crush;` and import it in `default`

## Justfile

Two changes:
1. **build**: add `crush` to the `all=` list
2. **update**: add `[crush]="charmbracelet/crush"` to the repos associative array

# Files to modify

1. **`packages/crush.nix`** (new) — Nix derivation, autoPatchelfHook, installs binary + completions + manpage
2. **`home-manager/crush/default.nix`** (new) — Home Manager module: enable option, skills link, settings file, shell alias
3. **`home-manager/crush/settings.nix`** (new) — Nix attrset for `crush.json` (permissions, LSPs, attribution)
4. **`flake.nix`** — Add crush to overlay, packages, homeManagerModules, and default module imports
5. **`Justfile`** — Add crush to build `all` list and update `repos` map

# Verification, success criteria

```bash
# 1. Build the package
nix build .#crush

# 2. Verify it runs
./result/bin/crush --version
# Expected: crush version 0.43.1

# 3. Build all packages (ensure nothing broke)
just build

# 4. Check version is evaluable
nix eval --raw .#crush.version
# Expected: 0.43.1

# 5. Verify shell completions and manpage are installed
ls ./result/share/zsh/site-functions/_crush
ls ./result/share/bash-completion/completions/crush.bash
ls ./result/share/fish/vendor_completions.d/crush.fish
ls ./result/share/man/man1/crush.1.gz
```

# Todo items

1. Create `packages/crush.nix` — autoPatchelfHook derivation with binary, completions, manpage
2. Create `home-manager/crush/settings.nix` — Nix attrset with permissions, LSPs, attribution
3. Create `home-manager/crush/default.nix` — Home Manager module with enable option, skills, settings, alias
4. Update `flake.nix` — add crush to overlay, packages, homeManagerModules, default imports
5. Update `Justfile` — add crush to build all-list and update repos map
6. Build and verify with `nix build .#crush` and `just build`
