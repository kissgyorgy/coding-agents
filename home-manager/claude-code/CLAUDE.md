# Tone and style

DO NOT use filler words and phrases like `modularize`, `maintainable`, `maintainability`,
 `testable`, `testability`, `focused`, `reusing`, `debugging`, `code organization`.
DO NOT add generalities or ego boosting phrases to commit messages about improving 
the code quality (like "improves maintainability"), as these are not objective facts.

Use these rules everywhere (replies, git commit messages, summary, task planning, todo tasks, etc.).


# devenv

devenv is a Declarative, Reproducible and Composable Developer Environments using Nix.
Look up devenv documentation before making changes with the `context7` MCP tool (`/cachix/devenv`)
Initialize devenv with the `devenv init` command if necessary
ALWAYS test devenv builds correctly after modifying `devenv.nix` with `devenv build` command


# git commit messages

Explain *what* was done in the in the first line of commit message.
Explain *why* the change was made in the commit message's body, the motivation
behind the change, if it can be inferred from either the changes or from the
prompts received.

Be succinct and information dense, use adjectives sparingly, as those are often
subjective, don't repeat simple changes trivially visible in the code.

Limit the subject line to 50 characters, wrap message body around 72 characters.

NEVER list which files you changed.


# Python

## Coding Style
NEVER make up or guess methods, variables class names, functions, modules or any
API. Only use those which you already read or know they exists for sure.

Don't comment code at all, don't write docstrings or doctests either.

When using `datetime`, import it like this: `import datetime as dt`
Use the new pipe operator for `Optional` variables like this: `value | None`

## Managing dependencies
Us the `uv` package manager for every dependency related task instead of editing files directly.
Use `uv add` for adding dependencies, never directly edit `pyproject.toml` files.
ALWAYS use `click` library instead of `argparse`, add it to dependencies if necessary.

## Tests
ALWAYS use `pytest` for all tests
ALWAYS assert on whole ouptut in tests, not just tiny parts
For mocking, use pytest `monkeypatch` fixture, NEVER `unittest.mock` and NEVER
any of the `Mock` classes or `patch` function
IMPORTANT: NEVER import from `conftest.py`


# Temporary files

When creating scripts, data, or temporary files for experiments, debugging or
checking output, put those in $PROJECT_ROOT/claudetmp directory.
Never delete anything from claudetmp/


# Project scripts and commands

- Write Justfile tasks instead of scripts for short scripts
- Write a script and run that from the Justfile task when it would exceed a couple of lines


# CSS

- IMPORTANT: ALWAYS use TailwindCSS, never use styles or style attribute.
- IMPORTANT: When using TailwindCSS classes, always write out the full name, don't dynamically concatenate it.
- Order TailwindCSS classes by ABC order in attributes
