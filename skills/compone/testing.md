# Testing compone Compoents

Always assert on the full output when testing a Component.

```python
import pytest
from compone import Component, html

@Component
def Greeting(name: str, formal: bool = False):
    greeting = f"Hello, {name}" if not formal else f"Greetings, {name}"
    return html.Div[html.H1[greeting]]

def test_greeting_informal():
    result = str(Greeting("Alice"))
    assert result == "<div><h1>Hello, Alice</h1></div>"

def test_greeting_formal():
    result = str(Greeting("Bob", formal=True))
    assert result == "<div><h1>Greetings, Bob</h1></div>"

```


### Attribute Validation Testing

```python
def test_progress_bar_validation():
    with pytest.raises(ValueError):
        ProgressBar(value=150, max_value=100)

    with pytest.raises(ValueError):
        ProgressBar(value=-10)
```
