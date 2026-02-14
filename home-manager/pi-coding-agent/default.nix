{ config, lib, pkgs, ... }:
let cfg = config.coding-agents.pi-coding-agent; in
{
  options.coding-agents.pi-coding-agent.enable =
    lib.mkEnableOption "Pi coding agent";
  config = lib.mkIf cfg.enable {
    home.file.".pi/agent/extensions".source = ./extensions;
    home.packages = [ pkgs.pi-coding-agent ];
  };
}
