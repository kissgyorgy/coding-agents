{ config, lib, pkgs, ... }:
let cfg = config.coding-agents.gemini-cli; in
{
  options.coding-agents.gemini-cli.enable = lib.mkEnableOption "Gemini CLI";
  config = lib.mkIf cfg.enable {
    home.packages = [ pkgs.gemini-cli ];
    programs.zsh.shellAliases.gemini =
      "${pkgs.gemini-cli}/bin/gemini --yolo --model pro";
  };
}
