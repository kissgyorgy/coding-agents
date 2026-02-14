{
  description = "Coding agent packages and home-manager modules";
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
    in
    {
      packages.${system} = {
        claude-code = pkgs.callPackage ./packages/claude-code.nix { };
        claude-code-ui = pkgs.callPackage ./packages/claude-code-ui.nix { };
        gemini-cli = pkgs.callPackage ./packages/gemini-cli.nix { };
        ccusage = pkgs.callPackage ./packages/ccusage.nix { };
        codex = pkgs.callPackage ./packages/codex.nix { };
        pi-coding-agent = pkgs.callPackage ./packages/pi-coding-agent.nix { };
      };

      overlays.default = final: prev: self.packages.${system};

      homeManagerModules = {
        claude-code = import ./home-manager/claude-code;
        codex = import ./home-manager/codex;
        gemini-cli = import ./home-manager/gemini-cli;
        pi-coding-agent = import ./home-manager/pi-coding-agent;
        default = { lib, ... }: {
          imports = [
            self.homeManagerModules.claude-code
            self.homeManagerModules.codex
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
