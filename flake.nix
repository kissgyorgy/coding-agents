{
  description = "Coding agent packages and home-manager modules";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
    pi.url = "github:earendil-works/pi/stable";
    hermes-agent = {
      url = "github:NousResearch/hermes-agent/v2026.4.30";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, hermes-agent, pi, ... }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-darwin" ];
      commonPackageNames = [
        "aichat"
        "claude-code"
        "claude-code-ui"
        "gemini-cli"
        "ccusage"
        "codex"
        "crush"
        "hermes-agent"
        "openclaude"
        "pi"
        "whichllm"
      ];
      linuxOnlyPackageNames = [
        "llmfit"
        "llmserve"
        "playwright-cli"
        "vibe-kanban"
      ];
      packageNames = {
        x86_64-linux = commonPackageNames ++ linuxOnlyPackageNames;
        aarch64-darwin = commonPackageNames;
      };
      pkgsFor = system: import nixpkgs {
        inherit system;
        config.allowUnfree = true;
        overlays = [ self.overlays.default ];
      };
    in
    {
      overlays.default = import ./overlay.nix { inherit hermes-agent pi; };

      packages = lib.genAttrs systems (system:
        let pkgs = pkgsFor system;
        in lib.genAttrs packageNames.${system} (name: pkgs.${name})
      );

      homeManagerModules = {
        claude-code = import ./home-manager/claude-code;
        codex = import ./home-manager/codex;
        gemini-cli = import ./home-manager/gemini-cli;
        crush = import ./home-manager/crush;
        hermes-agent = import ./home-manager/hermes-agent;
        pi = import ./home-manager/pi-coding-agent;
        default = import ./home-manager;
      };
    };
}
