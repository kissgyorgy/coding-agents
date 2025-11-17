# HTML Module

The `html` module provides all standard HTML5 elements.

## Structure Elements

```python
html.Html[...]           # <html>
html.Head[...]           # <head>
html.Body[...]           # <body>
html.Div[...]            # <div>
html.Span[...]           # <span>
html.Main[...]           # <main>
html.Header[...]         # <header>
html.Footer[...]         # <footer>
html.Nav[...]            # <nav>
html.Section[...]        # <section>
html.Article[...]        # <article>
html.Aside[...]          # <aside>
```

## Text Elements

```python
html.H1[...]             # <h1>
html.H2[...]             # <h2>
html.H3[...]             # <h3>
html.H4[...]             # <h4>
html.H5[...]             # <h5>
html.H6[...]             # <h6>
html.P[...]              # <p>
html.A[...]              # <a>
html.Strong[...]         # <strong>
html.Em[...]             # <em>
html.Code[...]           # <code>
html.Pre[...]            # <pre>
html.Blockquote[...]     # <blockquote>
html.Small[...]          # <small>
html.Mark[...]           # <mark>
html.Del[...]            # <del>
html.Ins[...]            # <ins>
html.Sub[...]            # <sub>
html.Sup[...]            # <sup>
```

## List Elements

```python
html.Ul[...]             # <ul>
html.Ol[...]             # <ol>
html.Li[...]             # <li>
html.Dl[...]             # <dl>
html.Dt[...]             # <dt>
html.Dd[...]             # <dd>
```

## Table Elements

```python
html.Table[...]          # <table>
html.Thead[...]          # <thead>
html.Tbody[...]          # <tbody>
html.Tfoot[...]          # <tfoot>
html.Tr[...]             # <tr>
html.Th[...]             # <th>
html.Td[...]             # <td>
html.Caption[...]        # <caption>
html.Colgroup[...]       # <colgroup>
html.Col[...]            # <col>
```

## Form Elements

```python
html.Form[...]           # <form>
html.Input(...)          # <input> (self-closing)
html.Textarea[...]       # <textarea>
html.Button[...]         # <button>
html.Select[...]         # <select>
html.Option[...]         # <option>
html.Label[...]          # <label>
html.Fieldset[...]       # <fieldset>
html.Legend[...]         # <legend>
html.Datalist[...]       # <datalist>
html.Output[...]         # <output>
html.Progress(...)       # <progress>
html.Meter(...)          # <meter>
```

## Media Elements

```python
html.Img(...)            # <img> (self-closing)
html.Video[...]          # <video>
html.Audio[...]          # <audio>
html.Source(...)         # <source> (self-closing)
html.Track(...)          # <track> (self-closing)
html.Picture[...]        # <picture>
html.Svg[...]            # <svg>
html.Canvas[...]         # <canvas>
```

## Interactive Elements

```python
html.Details[...]        # <details>
html.Summary[...]        # <summary>
html.Dialog[...]         # <dialog>
```

## Metadata Elements

```python
html.Title[...]          # <title>
html.Meta(...)           # <meta> (self-closing)
html.Link(...)           # <link> (self-closing)
html.Style[...]          # <style>
html.Script[...]         # <script>
html.Noscript[...]       # <noscript>
html.Base(...)           # <base> (self-closing)
```

## Other Elements

```python
html.Br(...)             # <br> (self-closing)
html.Hr(...)             # <hr> (self-closing)
html.Iframe[...]         # <iframe>
html.Embed(...)          # <embed> (self-closing)
html.Object[...]         # <object>
html.Param(...)          # <param> (self-closing)
html.Time[...]           # <time>
html.Data[...]           # <data>
html.Abbr[...]           # <abbr>
html.Address[...]        # <address>
html.Cite[...]           # <cite>
html.Kbd[...]            # <kbd>
html.Samp[...]           # <samp>
html.Var[...]            # <var>
html.Wbr(...)            # <wbr> (self-closing)
```


## Component Composition

Build complex components from simpler ones:

```python
@Component
def Button(text: str, variant: str = "primary", children=None):
    return html.Button(class_=f"btn btn-{variant}")[text, children]

@Component
def IconButton(icon: str, text: str, children=None):
    return Button(text)[
        html.I(class_=f"icon-{icon}"),
        children,
    ]

@Component
def Modal(title: str, show_close: bool = True, children=None):
    return html.Div(class_="modal")[
        html.Div(class_="modal-header")[
            html.H2[title],
            IconButton("close", "Close") if show_close else None,
        ],
        html.Div(class_="modal-body")[children],
    ]
```


## Escaping and Raw HTML

Compone automatically escapes strings for security. For raw HTML:

```python
from compone import safe

@Component
def RawContent(html_string: str, children=None):
    # WARNING: Only use with trusted content
    return html.Div[safe(html_string), children]
```
