{ hermes-agent, pi }:

final: prev: {
  aichat = final.callPackage ./packages/aichat.nix { };
  claude-code = final.callPackage ./packages/claude-code.nix { };
  claude-code-ui = final.callPackage ./packages/claude-code-ui.nix { };
  gemini-cli = final.callPackage ./packages/gemini-cli.nix { };
  ccusage = final.callPackage ./packages/ccusage.nix { };
  codex = final.callPackage ./packages/codex.nix { };
  crush = final.callPackage ./packages/crush.nix { };
  hermes-agent = hermes-agent.packages.${final.stdenv.hostPlatform.system}.default;
  openclaude = final.callPackage ./packages/openclaude.nix { };
  pi = final.callPackage ./packages/pi {
    pi = pi.packages.${final.stdenv.hostPlatform.system}.default;
  };
  whichllm = final.callPackage ./packages/whichllm.nix { };
  llmfit = final.callPackage ./packages/llmfit.nix { };
  llmserve = final.callPackage ./packages/llmserve.nix { };
  playwright-cli = final.callPackage ./packages/playwright-cli.nix { };
  vibe-kanban = final.callPackage ./packages/vibe-kanban.nix { };
}
