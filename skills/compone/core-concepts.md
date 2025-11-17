# Core Concepts

Basic features of compone, creating components, using attributes.

## Importing

```python
# HTML components
from compone import Component, html

# XML components
from compone import Component, xml
```

## Basic Component Syntax

Components are created using the `@Component` decorator:

```python
from compone import Component, html

@Component
def Button(text: str, variant: str = "primary", children=None):
    return html.Button(class_=f"btn btn-{variant}")[
        text,
        children,
    ]
```

**Key points:**
- Use `@Component` decorator on functions
- Type hint all parameters (required for type safety)
- `children` parameter receives nested content
- Return markup using bracket notation for simple components
- Use context manager syntax for complex components with inline code

## Nesting Components

Components are called like functions and can be nested:

```python
# Simple usage
Button("Click me")

# With children using bracket notation
Button("Submit")["Save changes"]

# Nested components
html.Form[
    html.Label["Name:"],
    html.Input(type="text", name="username"),
    Button("Submit", variant="success"),
]
```

### Children Handling

The `children` parameter captures nested content:

```python
@Component
def Card(title: str, children=None):
    return html.Div(class_="card")[
        html.H2[title],
        html.Div(class_="card-body")[children],
    ]

Card("My Card")[
    html.P["First paragraph"],
    html.P["Second paragraph"],
]
```

### Bracket Notation

You can nest elements with bracket notation

```python
html.Div[
    html.H1["Title"],
    html.P["Paragraph text"],
]
```

- `html.TagName[children]` creates elements, `children` is passed as children keyword argument
- Multiple children separated by commas
- Strings, other elements, and components can be nested
- Use parentheses for attributes: `html.Div(class_="container")[...]`

### Context manager notation

You can nest elements with context manager notation too:

```python
from compone import Component, html

@Component
def ComplexComponent(text: str, variant: str = "primary", children=None):
    with html.Div(class_="container") as div:
        with html.Span(class_="italic") as span:
            span += html.Button(class_=f"btn btn-{variant}")[
                text,
                children,
            ]
    return div
```

You can mix and match Context Manager Notation and Bracket Notation, use the inline append operator `+=`
to append elements as the children of the context manager object.

They render the same way, for example, this components render the same output as the `ComplexComponent`:

```python
@Component
def ComplexComponent(text: str, variant: str = "primary", children=None):
    return html.Div(class_="container")[
        html.Span(class_="italic")[
            html.Button(class_=f"btn btn-{variant}")[
                text,
                children,
            ]
        ]
    ]
```


## Element Attributes

### Basic Attributes

Pass attributes as keyword arguments:

```python
html.Div(id="container", class_="wrapper")
html.A(href="/page", title="Link title")
html.Img(src="image.jpg", alt="Description")
```

### Hyphenated Attributes

Use underscores for hyphens in attribute names:

```python
html.Div(data_id="123")          # becomes data-id
html.Meta(http_equiv="refresh")  # becomes http-equiv
html.Button(aria_label="Close")  # becomes aria-label
```

### Boolean Attributes

Pass boolean values directly:

```python
html.Input(type="checkbox", checked=True)
html.Button(disabled=True)
html.Script(async_=True, defer=True)
```

Attributes with `False` value will not be rendered.

### Python keyword Attributes

Python keywords require trailing underscore:

```python
html.Label(for_="input-id")      # for is reserved
html.Div(class_="my-class")      # class is reserved
```

Attributes which are not valid Python argument names, can still be passed:
```python
html.Label(**{"invalid:python*-variable": "value"})
# <label invalid:python*-variable="value"></label>
```

### Default Values

```python
@Component
def Button(
    text: str,
    variant: str = "primary",
    size: str = "md",
    disabled: bool = False,
    children=None
):
    return html.Button(
        class_=f"btn btn-{variant} btn-{size}",
        disabled=disabled
    )[text, children]
```

### Required vs Optional Attributes

```python
from typing import Optional

@Component
def Article(
    title: str,                    # Required
    content: str,                  # Required
    author: Optional[str] = None,  # Optional
    tags: list[str] = [],          # Optional with default
    children=None
):
    return html.Article[
        html.H1[title],
        html.P(class_="author")[f"By {author}"] if author else None,
        html.Div[content],
        html.Div(class_="tags")[
            [html.Span[tag] for tag in tags]
        ] if tags else None,
        children,
    ]
```


## Self-Closing Elements

Elements that don't have closing tags use parentheses for attributes only:

```python
html.Img(src="image.jpg", alt="Description")
html.Input(type="text", name="username")
html.Br()
html.Hr()
html.Meta(charset="utf-8")
html.Link(rel="stylesheet", href="style.css")
```


## Type Safety

Leverage Python type hints for IDE support.
ALWAYS type hint ALL arguments:

```python
from typing import Literal

@Component
def Alert(
    message: str,
    level: Literal["info", "warning", "error"],
    dismissible: bool = False,
    children=None
):
    return html.Div(
        class_=f"alert alert-{level}",
        role="alert"
    )[
        message,
        children,
        html.Button("×") if dismissible else None,
    ]

# IDE will autocomplete and validate level parameter
Alert("Something went wrong", level="error", dismissible=True)
```

## Conditional Rendering

Use None with conditional expressions to ignore element rendering:

```python
@Component
def Message(text: str, show_icon: bool = True, children=None):
    return html.Div[
        html.I(class_="icon") if show_icon else None,
        html.Span[text],
        children,
    ]
```


## List Rendering

Use Python list comprehensions to render repeating elements:

```python
@Component
def TodoList(items: list[str], children=None):
    return html.Ul[
        [html.Li[item] for item in items],
        children,
    ]

# Usage
TodoList(["Task 1", "Task 2", "Task 3"])
```

### Caching Static Components

```python
from functools import lru_cache

@lru_cache(maxsize=128)
@Component
def StaticHeader(site_name: str):
    return html.Header[
        html.H1[site_name],
        html.Nav[
            html.A(href="/")["Home"],
            html.A(href="/about")["About"],
        ],
    ]

# Subsequent calls with same args use cached result
header1 = StaticHeader("My Site")
header2 = StaticHeader("My Site")  # Returns cached
```

### Prerendering Components

When a component can be completely static, render them at import time
and use contant variables:

```python
# Compute expensive strings once
FOOTER_HTML = str(html.Footer[
    html.P["© 2024 Company"],
    html.Nav[
        html.A(href="/terms")["Terms"],
        html.A(href="/privacy")["Privacy"],
    ],
])

@Component
def Page(title: str, children):
    return html.Html[
        html.Head[html.Title[title]],
        html.Body[
            children,
            FOOTER_HTML,  # Reuse precomputed string
        ],
    ]
```
