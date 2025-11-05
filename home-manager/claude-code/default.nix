{ pkgs, config, lib, ... }:

with config.lib;
{
  home.file = {
    ".claude/CLAUDE.md".source = file.mkOutOfStoreSymlink ./CLAUDE.md;
    ".claude/skills".source = file.mkOutOfStoreSymlink ./skills;
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
      settings = lib.pipe ./settings.nix [
        import
        builtins.toJSON
        (builtins.toFile "claude-settings.json")
      ];
    in
    {
      claude = "claude --dangerously-skip-permissions --settings ${settings}";
    };
}
