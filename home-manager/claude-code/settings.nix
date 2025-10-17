{
  permissions = {
    allow = [
      "Bash(pytest:*)"
      "Bash(cat:*)"
      "Bash(rg:*)"
      "Bash(git:*)"
      "Bash(ls:*)"
      "Bash(uv:*)"
      "Bash(ruff:*)"
      "Read"
      "Write"
      "Search"
      "Fetch"
      "WebFetch"
      "Edit"
      "mcp__context7"
    ];
  };

  hooks = {
    PreToolUse = [
      {
        matcher = "Bash";
        hooks = [
          {
            type = "command";
            command = "${./command-validator.py}";
          }
        ];
      }
    ];

    PostToolUse = [
      {
        matcher = "Edit|MultiEdit|Write";
        hooks = [
          {
            type = "command";
            command = "${../bin/format-file}";
          }
        ];
      }
    ];
  };

  statusLine = {
    type = "command";
    command = "${./statusline.sh}";
  };

  includeCoAuthoredBy = false;
}
