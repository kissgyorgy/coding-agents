{
  description = "Coding agent packages and home-manager modules";

  outputs = { self }:
    {
      overlays.default = final: prev: {
        claude-code = final.callPackage ./packages/claude-code.nix { };
        claude-code-ui = final.callPackage ./packages/claude-code-ui.nix { };
        gemini-cli = final.callPackage ./packages/gemini-cli.nix { };
        ccusage = final.callPackage ./packages/ccusage.nix { };
        codex = final.callPackage ./packages/codex.nix { };
        pi-coding-agent = final.callPackage ./packages/pi-coding-agent.nix { };
      };

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
