{ lib, ... }:
{
  imports = [
    ./claude-code
    ./codex
    ./crush
    ./gemini-cli
    ./hermes-agent
    ./pi-coding-agent
  ];

  options.coding-agents.skillsDir = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = "Path to skills directory for live editing via symlink. When null, uses the store path.";
  };
  options.coding-agents.agentsMdPath = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    description = "Path to global AGENTS.md for live editing via symlink. When null, uses the store path.";
  };
}
