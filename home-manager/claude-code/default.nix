{ pkgs, config, ... }:
{
  home.file = with config.lib; {
    ".claude/CLAUDE.md".source = file.mkOutOfStoreSymlink ./CLAUDE.md;
    ".claude/settings.json".source = file.mkOutOfStoreSymlink ./settings.json;
    ".claude/scripts/statusline".source = ./statusline.sh;
  };

  home.packages = with pkgs; [
    claude-code
    ccusage
  ];
}
