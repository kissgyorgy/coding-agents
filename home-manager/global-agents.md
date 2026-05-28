# General

- CRITICAL: Always verify symbols, function names, config options, module
  paths, variable names, CLI flags, and API fields against actual source code
  or documentation before using them. NEVER guess symbols which you have not
  seen or read before.

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

- Don't run linting, formatting or type checking at all, don't check for syntax
  or other errors either. They will run automatically by Pi and you will be
  notified every error when you finish.


# Temporary files

- When you want to write one-off scripts, data or temporary files for
  experiments, exploration, testing, answering questions, triggering runs or
  whatever, you can use `$CURRENT_DIRECTORY/claudetmp/` directory to write and
  run them.
- Never delete anything from `claudetmp/`
- Don't write one-off scripts inline, write reusable scripts in files instead
  and run them afterwards.


# File operations and paths
- When you want to write the exact same file to a different place with the exact same content,
  DON'T USE the write tool, use the mv command instead. This makes the move faster and more precise.

- If you got a Windows Path like "C:\Users\walkman\Downloads\picture.png", you are running in WSL2,
  translate this to the WSL path: /mnt/c/Users/walkman/Downloads/picture.png.

- When you want to revert file changes you made, use git operations instead of editing the file again.


# Git

- Don't commit, especially don't modify previous commit, only if asked by the user.
- When making commits, explain briefly why you did what you did. What was the
  problem you solved, why a specific design decision was made.
  Everything that you know but cannot seen in the code.
- Don't be too verbose in the commit message, make sure important details are there.
- No need to list what tests were you running or the thing "works", that should be the default.
