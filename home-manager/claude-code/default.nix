{ pkgs, config, ... }:
{
  home.file = with config.lib; {
    ".claude/CLAUDE.md".source = file.mkOutOfStoreSymlink ./CLAUDE.md;
    ".claude/settings.json".source = file.mkOutOfStoreSymlink ./settings.json;
    ".claude/scripts/statusline".source = ./statusline.sh;
    ".claude/scripts/command-validator.py".source = file.mkOutOfStoreSymlink ./command-validator.py;
  };

  home.packages = with pkgs; [
    claude-code
    ccusage
  ];

  programs.zsh.shellAliases = {
    claude = "claude --dangerously-skip-permissions --settings ${./permission-settings.json}";
  };
}
