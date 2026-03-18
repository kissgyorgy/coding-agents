---
name: python
description: Write clean, readable Pythonic code. Use this skill any time you write or change a Python file.
---

# Coding Style
Always write clean, readable, well separated, well organized, Pythonic code.
Don't run linters or formatters, they will run automatically after every edit by the harness.


# Type hints
- ALWAYS type hint every function and method signature precisely even in tests.
- "" -> None" return values are not necessary, they are just noise.
- No need to type hint variables from functions call return values inside function bodies, they are inferred from the method return type,
  except extreme cases when the type is a huge help or a generic and it's concrete type cannot be determined.


# Testing
- NEVER use mocks, never assert on method calls, just use real objects and assert on results. When absolutely necessary and can't be avoided,
  use `pytest.monkeypatch`, but that should be rare when the setup would be too different or the code have side effects, but in that case,
  consider writing a fake instead of using Mock or MagicMock.
- ALWAYS assert on the full result of the function call, never just list length or containment, except where that's the point.
