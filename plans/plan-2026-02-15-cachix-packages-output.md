# Overview

Add a `packages` output to the flake (required so we can `nix build .#<pkg>`) and add a Cachix push step to the existing GitHub Actions workflow. This requires a `nixpkgs` input in the flake and a `CACHIX_AUTH_TOKEN` repository secret.

# Implementation plan

### Why we need a `packages` output

The flake currently has `outputs = { self }:` — zero inputs, only an overlay. There's no way to `nix build .#claude-code` because there's no `packages` output. The Justfile already references `packages.x86_64-linux.<pkg>` for `nix-update`, suggesting this output was intended. Adding `nixpkgs` as an input and exposing a `packages.x86_64-linux` set enables both `nix build` and Cachix pushing. The overlay remains available for users who bring their own nixpkgs.

### Cachix integration

The `cachix/cachix-action` sets up the `cachix` CLI and starts a `watch-store` daemon that automatically pushes every newly-built store path. We place it before the build step. After the update + git push, we explicitly `nix build` all packages so they (and their closures) land in the Cachix cache.

The existing `DeterminateSystems/magic-nix-cache-action` is kept — it caches build inputs in GitHub Actions cache for CI speed, while Cachix serves as the **public** binary cache for consumers.

### Auth token

The user needs to generate a Cachix auth token (`cachix authtoken`) and add it as the `CACHIX_AUTH_TOKEN` secret in the GitHub repository settings.

# Files to modify

### 1. `flake.nix`

Add `nixpkgs` input, add `packages.x86_64-linux` output. The overlay stays unchanged.

```nix
{
  description = "Coding agent packages and home-manager modules";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      pkgs = import nixpkgs {
        system = "x86_64-linux";
        overlays = [ self.overlays.default ];
      };
    in
    {
      overlays.default = final: prev: {
        claude-code = final.callPackage ./packages/claude-code.nix { };
        claude-code-ui = final.callPackage ./packages/claude-code-ui.nix { };
        gemini-cli = final.callPackage ./packages/gemini-cli.nix { };
        ccusage = final.callPackage ./packages/ccusage.nix { };
        codex = final.callPackage ./packages/codex.nix { };
        pi-coding-agent = final.callPackage ./packages/pi-coding-agent.nix { };
      };

      packages.x86_64-linux = {
        inherit (pkgs) claude-code claude-code-ui gemini-cli ccusage codex pi-coding-agent;
      };

      homeManagerModules = { /* unchanged */ };
    };
}
```

This will also generate a `flake.lock` on first `nix flake lock`.

### 2. `.github/workflows/update.yml`

Add `cachix/cachix-action` step and an explicit build step at the end:

```yaml
name: Update packages

on:
  schedule:
    - cron: '0 5 * * *'
    - cron: '30 11 * * *'
    - cron: '30 17 * * *'
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: DeterminateSystems/nix-installer-action@main

      - uses: DeterminateSystems/magic-nix-cache-action@main

      - uses: cachix/cachix-action@v15
        with:
          name: coding-agents
          authToken: '${{ secrets.CACHIX_AUTH_TOKEN }}'

      - name: Install tools
        run: nix profile install nixpkgs#just nixpkgs#nix-update nixpkgs#gh

      - name: Run update
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          just update

      - name: Push changes
        run: git push

      - name: Build packages
        run: nix build .#claude-code .#claude-code-ui .#gemini-cli .#ccusage .#codex .#pi-coding-agent
```

The cachix-action's `watch-store` daemon runs in the background and automatically pushes every derivation built after it starts (including the final `nix build` outputs). Its post-action hook flushes any remaining paths.

# Todo items
1. CACHIX_AUTH_TOKEN secret
2. Flake.nix
3. Nix flake lock
4. .github/workflows/update.yml
5. Commit and push
