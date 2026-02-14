{ config, lib, pkgs, ... }:
let cfg = config.coding-agents.codex; in
{
  options.coding-agents.codex.enable = lib.mkEnableOption "OpenAI Codex";
  config = lib.mkIf cfg.enable {
    home.packages = [ pkgs.codex ];
  };
}
