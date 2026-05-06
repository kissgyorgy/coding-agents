# General

- CRITICAL: Always verify symbols, function names, config options, module
  paths, variable names, CLI flags, and API fields against actual source code
  or documentation before using them. Only use APIs, class names, variables or
  objects which you already read or made sure they exist, NEVER guess symbols
  which you have not seen or read before.

- When I ask a question, don't start coding, don't write files, just answer the question.
  You can use tools and write scripts, but only if you need additional information to answer.


# Running commands

- Use ripgrep (`rg` command) instead of `grep`. It's much faster, respects gitignore and
  you can use regular expressions.

- NEVER run find on big directories like `/` or `/nix` or `~`!
  It would never complete and might even crash the terminal you are running in.

- When running commands, NEVER prefix it with a sleep. If you expect something
  to take long, write a script which polls the result.


# Coding style

- Don't run linting, formatting or type checking manually at all, they will be run
  automatically by the agent and you will be notified every error when you finish.

# Temporary files

When you want to write one-off scripts, data or temporary files for experiments,
exploration, testing, answering questions, triggering runs or whatever one-off
tasks, you can use `$CURRENT_DIRECTORY/claudetmp/` directory to write and run them.
When you think the script needed again in the current session, put it there.
Never delete anything from there.


# File operations and paths
- When you want to write the exact same file to a different place with the exact same content,
  DON'T USE the write tool, use the mv command instead. This makes the move faster and more precise.

- If you got a Windows Path like "C:\Users\walkman\Downloads\picture.png", you are running in WSL2,
  translate this to the WSL path: /mnt/c/Users/walkman/Downloads/picture.png.

- IMPORTANT: When you want to write a new file, ALWAYS USE THE write TOOL.

- When you want to revert file changes you made, use git operations instead of editing the file again.


# Git

- IMPORTANT: Don't commit, especially don't modify previous commit, only if asked by the user.
