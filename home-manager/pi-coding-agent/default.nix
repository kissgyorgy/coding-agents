{ config, lib, pkgs, ... }:
let
  cfg = config.coding-agents.pi-coding-agent;
  skillsDir = config.coding-agents.skillsDir;
  agentsMdPath = config.coding-agents.agentsMdPath;
  symlink = config.lib.file.mkOutOfStoreSymlink;
in
{
  options.coding-agents.pi-coding-agent = {
    enable = lib.mkEnableOption "Pi coding agent";
    extensionsDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Path to extensions directory for live editing via symlink. When null, uses the store path.";
    };
    promptsDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Path to prompts directory for live editing via symlink. When null, uses the store path.";
    };
  };
  config = lib.mkIf cfg.enable {
    home.file.".pi/agent/AGENTS.md".source =
      if agentsMdPath != null then symlink agentsMdPath else ../global-agents.md;
    home.file.".pi/agent/extensions".source =
      if cfg.extensionsDir != null then symlink cfg.extensionsDir else ./extensions;
    home.file.".pi/agent/prompts".source =
      if cfg.promptsDir != null then symlink cfg.promptsDir else ./prompts;
    home.file.".pi/agent/skills".source =
      if skillsDir != null then symlink skillsDir else ../../skills;
    home.packages = with pkgs;[ pi-coding-agent wl-clipboard ];
  };
}
