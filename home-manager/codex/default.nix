{ config, lib, pkgs, ... }:
let
  cfg = config.coding-agents.codex;
  skillsDir = config.coding-agents.skillsDir;
  symlink = config.lib.file.mkOutOfStoreSymlink;
in
{
  options.coding-agents.codex.enable = lib.mkEnableOption "OpenAI Codex";
  config = lib.mkIf cfg.enable {
    home.file.".agents/skills".source =
      if skillsDir != null then symlink skillsDir else ../../skills;
    home.packages = [ pkgs.codex ];
  };
}
