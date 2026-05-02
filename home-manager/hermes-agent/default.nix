{ config, lib, pkgs, ... }:
let
  cfg = config.coding-agents.hermes-agent;
in
{
  options.coding-agents.hermes-agent.enable = lib.mkEnableOption "Hermes Agent";

  config = lib.mkIf cfg.enable {
    home.packages = [ pkgs.hermes-agent ];
  };
}
