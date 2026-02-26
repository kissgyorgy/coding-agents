{
  description = "Coding agent packages and home-manager modules";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      pkgs = import nixpkgs {
        system = "x86_64-linux";
        config.allowUnfree = true;
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
        crush = final.callPackage ./packages/crush.nix { };
        pi-coding-agent = final.callPackage ./packages/pi-coding-agent { };
        playwright-cli = final.callPackage ./packages/playwright-cli.nix { };
        vibe-kanban = final.callPackage ./packages/vibe-kanban.nix { };
      };

      packages.x86_64-linux = {
        inherit (pkgs) claude-code claude-code-ui gemini-cli ccusage codex crush pi-coding-agent playwright-cli vibe-kanban;
      };

      homeManagerModules = {
        claude-code = import ./home-manager/claude-code;
        codex = import ./home-manager/codex;
        gemini-cli = import ./home-manager/gemini-cli;
        crush = import ./home-manager/crush;
        pi-coding-agent = import ./home-manager/pi-coding-agent;
        default = { lib, ... }: {
          imports = [
            self.homeManagerModules.claude-code
            self.homeManagerModules.codex
            self.homeManagerModules.crush
            self.homeManagerModules.gemini-cli
            self.homeManagerModules.pi-coding-agent
          ];
          options.coding-agents.skillsDir = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Path to skills directory for live editing via symlink. When null, uses the store path.";
          };
        };
      };
    };
}
