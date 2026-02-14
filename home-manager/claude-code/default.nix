{ config, lib, pkgs, ... }:
let
  cfg = config.coding-agents.claude-code;
  apiKeyRef = "op://Secrets/anthropic-api-key/credential";
in
{
  options.coding-agents.claude-code = {
    enable = lib.mkEnableOption "Claude Code AI coding assistant";
    claudeMdPath = lib.mkOption {
      type = lib.types.path;
      default = ./CLAUDE.md;
      description = "Source for CLAUDE.md config file";
    };
  };

  config = lib.mkIf cfg.enable {
    home.file = {
      ".claude/CLAUDE.md".source = cfg.claudeMdPath;
      ".claude/skills".source = config.coding-agents.skillsDir;
    };

    home.packages = with pkgs; [
      claude-code
      ccusage
      socat
      bubblewrap
    ];

    programs.zsh.shellAliases =
      let
        settings = import ./settings.nix;
        makeJSON = fname: json: pkgs.writeText fname (builtins.toJSON json);
        settingsJSON = makeJSON "claude-settings.json" settings;
        apiSettingsJSON = makeJSON "api-settings.json" (settings // {
          apiKeyHelper = "${pkgs.writeShellScript "get-api-key" "op read ${apiKeyRef}"}";
          forceLoginMethod = "console";
        });
        claude-cli = "${pkgs.claude-code}/bin/claude --dangerously-skip-permissions";
      in
      {
        claude = "${claude-cli} --settings ${settingsJSON}";
        claude-api = "${claude-cli} --settings ${apiSettingsJSON}";
      };
  };
}
