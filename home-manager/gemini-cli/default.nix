{ config, lib, pkgs, ... }:
let
  cfg = config.coding-agents.gemini-cli;
  agentsMdPath = config.coding-agents.agentsMdPath;
  symlink = config.lib.file.mkOutOfStoreSymlink;
in
{
  options.coding-agents.gemini-cli.enable = lib.mkEnableOption "Gemini CLI";
  config = lib.mkIf cfg.enable {
    home.file.".gemini/GEMINI.md".source =
      if agentsMdPath != null then symlink agentsMdPath else ../global-agents.md;
    home.packages = [ pkgs.gemini-cli ];
    programs.zsh.shellAliases.gemini =
      "${pkgs.gemini-cli}/bin/gemini --yolo --model pro";
  };
}
