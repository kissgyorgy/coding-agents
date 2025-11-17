# Web Framework Integration

Compone components return strings that work with any Python web framework:

```python
# Flask
@app.route("/")
def index():
    return str(HomePage()["Welcome"])

# FastAPI
@app.get("/")
def index():
    return HTMLResponse(HomePage()["Welcome"])

# Django
def index(request):
    return HttpResponse(HomePage()["Welcome"])
```


## Flask Blog Application

```python
from flask import Flask, request
from compone import Component, html

app = Flask(__name__)

@Component
def Layout(title: str, children):
    return html.Html[
        html.Head[
            html.Meta(charset="utf-8"),
            html.Title[title],
            html.Link(rel="stylesheet", href="/static/style.css"),
        ],
        html.Body[
            html.Header[
                html.H1["My Blog"],
                html.Nav[
                    html.A(href="/")["Home"],
                    html.A(href="/about")["About"],
                ],
            ],
            html.Main[children],
            html.Footer[
                html.P["© 2024 My Blog"],
            ],
        ],
    ]

@Component
def PostCard(title: str, excerpt: str, date: str, url: str):
    return html.Article(class_="post-card")[
        html.H2[html.A(href=url)[title]],
        html.Time(datetime=date)[date],
        html.P[excerpt],
        html.A(href=url, class_="read-more")["Read more →"],
    ]

@Component
def PostList(posts: list, children=None):
    return html.Div(class_="post-list")[
        [PostCard(
            title=post["title"],
            excerpt=post["excerpt"],
            date=post["date"],
            url=f"/post/{post['id']}"
        ) for post in posts],
        children,
    ]

@app.route("/")
def index():
    posts = [
        {"id": 1, "title": "First Post", "excerpt": "This is my first post...", "date": "2024-01-01"},
        {"id": 2, "title": "Second Post", "excerpt": "Another great post...", "date": "2024-01-05"},
    ]
    return str(Layout("Home")[PostList(posts)])

@app.route("/post/<int:post_id>")
def post_detail(post_id):
    post = {
        "title": f"Post {post_id}",
        "content": "Full post content here...",
        "date": "2024-01-01",
    }
    return str(Layout(post["title"])[
        html.Article[
            html.H1[post["title"]],
            html.Time(datetime=post["date"])[post["date"]],
            html.Div(class_="content")[post["content"]],
        ]
    ])

if __name__ == "__main__":
    app.run(debug=True)
```


## FastAPI App with HTML Views

```python
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from compone import Component, html
from typing import Optional

app = FastAPI()

@Component
def Page(title: str, children):
    return html.Html[
        html.Head[
            html.Meta(charset="utf-8"),
            html.Meta(name="viewport", content="width=device-width, initial-scale=1"),
            html.Title[title],
            html.Link(rel="stylesheet", href="https://cdn.simplecss.org/simple.min.css"),
        ],
        html.Body[children],
    ]

@Component
def Form(action: str, method: str = "post", children=None):
    return html.Form(action=action, method=method)[children]

@Component
def TextField(
    name: str,
    label: str,
    type: str = "text",
    required: bool = False,
    value: str = "",
):
    return html.Div[
        html.Label(for_=name)[label],
        html.Input(
            type=type,
            id=name,
            name=name,
            value=value,
            required=required,
        ),
    ]

@Component
def Button(text: str, type: str = "submit", children=None):
    return html.Button(type=type)[text, children]

# In-memory database
tasks = []

@app.get("/", response_class=HTMLResponse)
async def task_list():
    return str(Page("Todo List")[
        html.H1["My Tasks"],
        html.Ul[
            [html.Li[
                task["title"],
                html.Form(action=f"/tasks/{i}/delete", method="post", style="display:inline")[
                    Button("Delete", type="submit")
                ]
            ] for i, task in enumerate(tasks)]
        ] if tasks else html.P["No tasks yet."],
        html.H2["Add Task"],
        Form(action="/tasks/create")[
            TextField("title", "Task", required=True),
            Button("Add Task"),
        ],
    ])

@app.post("/tasks/create", response_class=RedirectResponse)
async def create_task(title: str = Form(...)):
    tasks.append({"title": title, "completed": False})
    return RedirectResponse(url="/", status_code=303)

@app.post("/tasks/{task_id}/delete", response_class=RedirectResponse)
async def delete_task(task_id: int):
    if 0 <= task_id < len(tasks):
        tasks.pop(task_id)
    return RedirectResponse(url="/", status_code=303)
```


## Django View with Components

```python
# components.py
from compone import Component, html
from typing import Optional

@Component
def BaseLayout(title: str, children):
    return html.Html[
        html.Head[
            html.Meta(charset="utf-8"),
            html.Title[f"{title} - My Django Site"],
            html.Link(rel="stylesheet", href="/static/css/style.css"),
        ],
        html.Body[
            html.Header[
                html.Nav[
                    html.A(href="/")["Home"],
                    html.A(href="/products/")["Products"],
                    html.A(href="/contact/")["Contact"],
                ],
            ],
            html.Main[children],
        ],
    ]

@Component
def ProductCard(name: str, price: float, image_url: str, product_id: int):
    return html.Div(class_="product-card")[
        html.Img(src=image_url, alt=name),
        html.H3[name],
        html.P(class_="price")[f"${price:.2f}"],
        html.A(href=f"/products/{product_id}/", class_="btn")["View Details"],
    ]

# views.py
from django.http import HttpResponse
from .components import BaseLayout, ProductCard
from .models import Product

def product_list(request):
    products = Product.objects.all()

    content = BaseLayout("Products")[
        html.H1["Our Products"],
        html.Div(class_="product-grid")[
            [ProductCard(
                name=p.name,
                price=p.price,
                image_url=p.image.url,
                product_id=p.id
            ) for p in products]
        ],
    ]

    return HttpResponse(str(content))

def product_detail(request, product_id):
    product = Product.objects.get(id=product_id)

    content = BaseLayout(product.name)[
        html.Article[
            html.H1[product.name],
            html.Img(src=product.image.url, alt=product.name),
            html.P(class_="price")[f"${product.price:.2f}"],
            html.Div(class_="description")[product.description],
            html.Form(action=f"/cart/add/{product.id}/", method="post")[
                html.Button(type="submit")["Add to Cart"],
            ],
        ],
    ]

    return HttpResponse(str(content))
```
