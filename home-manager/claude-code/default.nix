{ pkgs, config, ... }:
let
  apiKeyRef = "op://Secrets/anthropic-api-key/credential";
in
with config.lib;
{
  home.file = {
    ".claude/CLAUDE.md".source = file.mkOutOfStoreSymlink "/home/walkman/nixconf/home/claude-code/CLAUDE.md";
    ".claude/skills".source = file.mkOutOfStoreSymlink "/home/walkman/nixconf/home/claude-code/skills";
  };

  home.packages = with pkgs; [
    claude-code
    ccusage
    # these are required for sandboxing
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
}
