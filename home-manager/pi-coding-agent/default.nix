{ config, lib, pkgs, ... }:
let cfg = config.coding-agents.pi-coding-agent; in
{
  options.coding-agents.pi-coding-agent = {
    enable = lib.mkEnableOption "Pi coding agent";
    extensionsDir = lib.mkOption {
      type = lib.types.path;
      default = ./extensions;
      description = "Source for pi extensions directory";
    };
  };
  config = lib.mkIf cfg.enable {
    home.file.".pi/agent/extensions".source = cfg.extensionsDir;
    home.file.".pi/agent/skills".source = config.coding-agents.skillsDir;
    home.packages = [ pkgs.pi-coding-agent ];
  };
}
