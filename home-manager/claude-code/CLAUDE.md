# Tool usage

# Use rigrep instead of grep
Never use the `grep` command, use the Grep, Glob or Search tool for simple pattern search.
Use `rg` (ripgrep) command for complex searches (e.g. in a shell pipe)
<example>
Instead of: `cat file.txt | grep "search phrase"`
Do this: `cat file.txt | rg "search phrase"`
</example>


# Message Tone and style

DO NOT use filler words and phrases like `modularize`, `maintainable`, `maintainability`,
 `testable`, `testability`, `focused`, `reusing`, `debugging`, `code organization`.
DO NOT add generalities or ego boosting phrases to commit messages about improving
the code quality (like "improves maintainability"), as these are not objective facts.

Use this style everywhere (replies, git commit messages, summary, task planning, todo tasks, etc.).


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
- IMPORTANT: NEVER comment code at all, don't write docstrings or doctests either.
- NEVER make up or guess methods, variables class names, functions, modules or any API.
- Only use APIs, class names, variables or objects which you already read or
  know exist for sure.
- When using `datetime`, import it like this: `import datetime as dt`
- Use the new pipe operator for `Optional` variables like this: `value | None`

## Managing dependencies
- Use `uv add` for adding dependencies, never directly edit `pyproject.toml` files.
- ALWAYS use `click` library instead of `argparse`, add it to dependencies if necessary.

## Tests
- ALWAYS use `pytest` for all tests
- ALWAYS assert on whole ouptut in tests, not just tiny parts
- For mocking, use pytest `monkeypatch` fixture, NEVER `unittest.mock` and NEVER
  any of the `Mock` classes or `patch` function
- IMPORTANT: NEVER import from `conftest.py`
- ALWAYS type hint test function parameters correctly.
- Don't make a test class with only one function, a module-level test function is enough


# Temporary files

When creating scripts, data, or temporary files for experiments, debugging or
checking output, put those in `$PROJECT_ROOT/claudetmp` directory.
Never delete anything from `claudetmp/`


# Project scripts and commands

- Write Justfile tasks instead of scripts for short scripts
- Write a script and run that from the Justfile task when it would exceed a couple of lines


# CSS

- IMPORTANT: ALWAYS use TailwindCSS, never use styles or style attribute.
- IMPORTANT: When using TailwindCSS classes, always write out the full name, don't dynamically concatenate it.
- Order TailwindCSS classes by ABC order in attributes
