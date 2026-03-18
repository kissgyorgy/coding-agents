{ config, lib, pkgs, ... }:
let
  cfg = config.coding-agents.codex;
  skillsDir = config.coding-agents.skillsDir;
  agentsMdPath = config.coding-agents.agentsMdPath;
  symlink = config.lib.file.mkOutOfStoreSymlink;
in
{
  options.coding-agents.codex.enable = lib.mkEnableOption "OpenAI Codex";
  config = lib.mkIf cfg.enable {
    home.file.".agents/skills".source =
      if skillsDir != null then symlink skillsDir else ../../skills;
    home.file.".codex/AGENTS.md".source =
      if agentsMdPath != null then symlink agentsMdPath else ../global-agents.md;
    home.packages = [ pkgs.codex ];
  };
}
