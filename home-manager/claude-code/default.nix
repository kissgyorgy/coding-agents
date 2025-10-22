{ pkgs, config, lib, ... }:
{
  home.file = with config.lib; {
    ".claude/CLAUDE.md".source = file.mkOutOfStoreSymlink ./CLAUDE.md;
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
