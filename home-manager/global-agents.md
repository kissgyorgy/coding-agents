# General

- CRITICAL: Always verify symbols, function names, config options, module
  paths, variable names, CLI flags, and API fields against actual source code
  or documentation before using them. NEVER guess symbols which you have not
  seen or read before.

- When I ask a question, don't start coding, don't write files, just answer the question.
  You can use tools and write scripts, but only if you need additional information to answer.

- When you can determine how something works locally, don't make a `web_search`.
  Use command line programs help, manual pages or source code to look things up
  locally instead.

- When changing or refactoring code and schema, don't keep backward
  compatibility unless explicitly asked. Just make the change and if necessary
  write data migrations to the new schema.

- Never write subheadings in any kind of software, they are not helpful.


# Running commands

- Use ripgrep (`rg` command) instead of `grep`. It's much faster, respects gitignore and
  you can use regular expressions.

- NEVER run find on big directories like `/` or `/nix` or `~`!
  It would never complete and might even crash the terminal you are running in.

- Linting, formatting or type and syntax checking will run automatically,
  don't run them, you will be automatically notified about the problems.


# Using skills

When you already read a SKILL, don't read it again in the same conversation.


# Temporary files

- When you want to write one-off scripts, data or temporary files for
  experiments, exploration, testing, answering questions, triggering runs or
  whatever, you can use `$CURRENT_DIRECTORY/claudetmp/` directory to write and
  run them.

- Never delete anything from `claudetmp/`

- Always write **reusable scripts in files** and run them instead of writing
  inline scripts. Write wrapper scripts for repeating patterns.


# File operations and paths

- When you want to write the exact same file to a different place with the exact same content,
  use the `mv` command instead of the Write tool. This makes the move faster and more precise.

- If you got a Windows Path like `C:\Users\walkman\Downloads\picture.png`,
  you are running in WSL2, translate this to the WSL path:
  `/mnt/c/Users/walkman/Downloads/picture.png`.

- When you want to revert file changes you made, use git operations instead of
  editing the file again.


# Git

- ALWAYS use git. If the directory is empty, run `git init` first.

- NEVER modify previous commits, reset or run desctructive git operations, only
  when explicitly asked by the user.

- Be consice, but clear and precise in commit messages.

- In commit message body, explain the **WHY** of what you did. What was the
  problem you solved, why a specific design decision was made. Information that
  cannot be seen in the code.

- Group logical changes in separate commits. Adding a new dependency always go to a separate commit.

- Don't write in the commit message what you did, what tests were you running or
  the thing "works" or anything that can be seen in the code, only the short summary
  in the subject and the explanation in the body as instructed above.


# External project discovery and source code

When a user asks about how an external project works, implements something, it's
source code or similar questions, you can find checked out upstream git repos
in `~/Upstream` folder. You can use the existing repositories or even clone new
repos you need to inspect. Make sure the repo is updated and the right version
is checked out.
