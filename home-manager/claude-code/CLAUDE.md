# devenv

- devenv is a Declarative, Reproducible and Composable Developer Environments using Nix.
- Initialize devenv with the `devenv init` command if necessary.
- Look up devenv documentation before making changes with the `context7` MCP tool (`/cachix/devenv`).
- Always test devenv builds correctly after modifying `devenv.nix`


# git

- Please, do not mention yourself (Claude) as co-author or include any links to claude.ai in the commit messages.
- Explain *what* was done in the commit description in the first line of commit message
- Explain *why* the change was made in the commit message's body (rest of the lines):
  it should be all about the reason of the change
- Explain the motivation behind the change, if it can be inferred from either the changes or from the prompts received.
- Commit messages should be succinct and information dense
- Commit messages should use adjectives sparingly, as those are often subjective
- Do not use filler words and phrases like `modularize`, `maintainable`, `maintainability`, `testable`, `testability`, `focused`, `reusing`, `debugging`, `code organization`
- Commit messages should not repeat simple changes trivially visible in the code
- Do not add generalities or ego boosting phrases to commit messages about improving the code quality (like "improves maintainability"), as these are not objective facts
- Limit the subject line to 50 characters
- Wrap message body around 72 characters
- Never list which files you changed in commit messages


# Python

- Don't comment code at all, don't write doctests either
- Always use `pytest` for all tests
- Always assert on whole ouptut in tests, not just tiny parts
- For mocking, use pytest `monkeypatch` fixture, NEVER `unittest.mock` and NEVER any of the `Mock` classes or `patch` function
- Use `uv add` for adding dependencies, never directly edit `pyproject.toml` files.
- Always use `click` library instead of `argparse`, add it to dependencies if necessary
- When using `datetime`, import it like this: `import datetime as dt`
- In tests, NEVER import from `conftest.py`
- Use the new pipe operator for `Optional` variables like this: `value | None`


# Temporary files

- When creating scripts, data, or temporary files for experiments, debugging or checking output, 
  put those in $PROJECT_ROOT/claudetmp directory
- Never delete anything from claudetmp/


# Project scripts and commands

- Write Justfile tasks instead of scripts for short scripts
- Write a script and run that from the Justfile task when it would exceed a couple of lines


# CSS

- Always always use TailwindCSS, never use styles or style attribute.
- When using TailwindCSS classes, always write out the full name, don't dynamically concatenate it.
- Order TailwindCSS classes by ABC in an attribute
