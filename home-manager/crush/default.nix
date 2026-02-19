{ config, lib, pkgs, ... }:
let
  cfg = config.coding-agents.crush;
  skillsDir = config.coding-agents.skillsDir;
  symlink = config.lib.file.mkOutOfStoreSymlink;
  settings = import ./settings.nix;
  settingsJSON = pkgs.writeText "crush.json" (builtins.toJSON settings);
in
{
  options.coding-agents.crush = {
    enable = lib.mkEnableOption "Crush coding agent";
  };

  config = lib.mkIf cfg.enable {
    home.file = {
      ".config/crush/skills".source =
        if skillsDir != null then symlink skillsDir else ../../skills;
      ".config/crush/crush.json".source = settingsJSON;
    };

    home.packages = [ pkgs.crush ];

    programs.zsh.shellAliases = {
      crush = "${pkgs.crush}/bin/crush -y";
    };
  };
}
