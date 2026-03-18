---
name: python
description: Write clean, readable Pythonic code. Use this skill any time you write or change a Python file.
---

# General guidelines


# Coding Style
- Always write clean, readable, well separated, well organized, Pythonic code.
- Don't run linters or formatters, they will run automatically after every edit by the harness.
- When using `datetime`, import it like this: `import datetime as dt`


# Type hints
- ALWAYS type hint every function and method signature precisely even in tests.
- "" -> None" return values are not necessary, they are just noise.
- No need to type hint variables from functions call return values inside function bodies, they are inferred from the method return type,
  except extreme cases when the type is a huge help or a generic and it's concrete type cannot be determined.
- Only use APIs, class names, variables or objects which you already read or
  know exist for sure.
- Use the new pipe operator for `Optional` variables like this: `value | None`



# Testing
- ALWAYS use `pytest` for all tests
- ALWAYS assert on whole ouptut or full results in tests, not just tiny parts
- For mocking, use pytest `monkeypatch` fixture, NEVER `unittest.mock` and NEVER
  any of the `Mock` classes or `patch` function
- IMPORTANT: NEVER import from `conftest.py`
- ALWAYS type hint test function parameters correctly.
- Don't make a test class with only one function, a module-level test function is enough
- NEVER use `unittest.mock` or any of the `Mock` classes or `patch` function, never assert on method calls,
  use real objects and assert on full results. When absolutely necessary and can't be avoided, use `pytest.monkeypatch`,
  when the test setup would be too difficult or the code have side effects, but consider writing a fake.
- ALWAYS assert on the full result of the function call, never just list lengths or containment, except where that's the point.


# Managing dependencies

- Use `uv add` for adding dependencies, never directly edit `pyproject.toml` files.
- For CLI scripts and apps, ALWAYS use `click` library instead of `argparse`, add it to dependencies if necessary.
