---
description: Initialize an AGENTS.md file with codebase documentation
---

Analyze this codebase and create an AGENTS.md file, which will be given
to future instances of the coding agent to operate in this repository.

# What to add:

1. Commands that will be very frequently used, such as how to build or run tests.
   Inclued the command which can help the agent discover all important commands.
   for example `just help` or `some-cli --help`.

2. High-level code architecture and structure so that agents can find files
   more quickly and easily. Focus on the "big picture" architecture that
   requires reading multiple files to understand.

3. Brief overview of subsystems of this codebase. If it's a monorepo, make sure
   to include the very high level directory structure. If it's modular, list the
   most important folders and it's related subsystems.


# Usage notes:

- If there's already an AGENTS.md, suggest improvements to it.

- When you make the initial AGENTS.md, do not repeat yourself and do not include
  obvious instructions like "Provide helpful error messages to users", "Write
  unit tests for all new utilities", "Never include sensitive information (API
  keys, tokens) in code or commits".

- Avoid listing every component or file structure that can be easily discovered.

- Don't include generic development practices, any formatting rules, linting advice
  or anything that a tool or pre-commit can check. Those will be automatically checked
  and fixed by the harness without the agent.

- If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules
  (in .github/copilot-instructions.md), make sure to include the important parts.

- If there is a README.md, make sure to include the important parts.

- Do not make up information such as "Common Development Tasks", 
  "Tips for Development", "Support and Documentation" unless this is 
  expressly included in other files that you read.
