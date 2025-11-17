## Component Libraries

### UI Component Library

```python
# ui_library.py
from compone import Component, html
from typing import Literal, Optional

@Component
def Container(
    max_width: Literal["sm", "md", "lg", "xl"] = "lg",
    children=None
):
    widths = {"sm": "640px", "md": "768px", "lg": "1024px", "xl": "1280px"}
    return html.Div(
        class_="container",
        style=f"max-width: {widths[max_width]}; margin: 0 auto; padding: 0 1rem;"
    )[children]

@Component
def Button(
    text: str,
    variant: Literal["primary", "secondary", "danger"] = "primary",
    size: Literal["sm", "md", "lg"] = "md",
    disabled: bool = False,
    children=None
):
    return html.Button(
        class_=f"btn btn-{variant} btn-{size}",
        disabled=disabled
    )[text, children]

@Component
def Card(
    title: Optional[str] = None,
    footer: Optional[str] = None,
    children=None
):
    return html.Div(class_="card")[
        html.Div(class_="card-header")[html.H3[title]] if title else None,
        html.Div(class_="card-body")[children],
        html.Div(class_="card-footer")[footer] if footer else None,
    ]

@Component
def Grid(
    cols: int = 2,
    gap: int = 4,
    children=None
):
    return html.Div(
        class_="grid",
        style=f"display: grid; grid-template-columns: repeat({cols}, 1fr); gap: {gap}rem;"
    )[children]

@Component
def Alert(
    message: str,
    level: Literal["info", "warning", "error", "success"] = "info",
    dismissible: bool = False,
    children=None
):
    icons = {
        "info": "ℹ",
        "warning": "⚠",
        "error": "✖",
        "success": "✓",
    }
    return html.Div(
        class_=f"alert alert-{level}",
        role="alert"
    )[
        html.Span(class_="alert-icon")[icons[level]],
        html.Span[message, children],
        html.Button(
            class_="alert-close",
            type="button",
            aria_label="Close"
        )["×"] if dismissible else None,
    ]

@Component
def Badge(
    text: str,
    variant: Literal["primary", "secondary", "success", "danger"] = "primary",
):
    return html.Span(class_=f"badge badge-{variant}")[text]

@Component
def List(
    items: list[str],
    ordered: bool = False,
    children=None
):
    ListTag = html.Ol if ordered else html.Ul
    return ListTag[
        [html.Li[item] for item in items],
        children,
    ]

# Usage example
if __name__ == "__main__":
    page = Container(max_width="lg")[
        html.H1["Component Library Demo"],

        Alert("This is an info alert", level="info", dismissible=True),

        Grid(cols=3, gap=2)[
            Card(title="Card 1", footer="Footer 1")[
                html.P["Card content here"],
                Button("Click me", variant="primary"),
            ],
            Card(title="Card 2", footer="Footer 2")[
                html.P["More content"],
                Button("Action", variant="secondary"),
            ],
            Card(title="Card 3")[
                html.P["Another card"],
                Badge("New", variant="success"),
            ],
        ],

        List(["Item 1", "Item 2", "Item 3"], ordered=True),
    ]

    print(str(page))
```

### Form Component Library

```python
# forms.py
from compone import Component, html
from typing import Optional, Literal

@Component
def FormGroup(
    label: str,
    name: str,
    help_text: Optional[str] = None,
    error: Optional[str] = None,
    required: bool = False,
    children=None
):
    return html.Div(class_="form-group")[
        html.Label(for_=name, class_="form-label")[
            label,
            html.Span(class_="required")["*"] if required else None,
        ],
        children,
        html.Small(class_="form-help")[help_text] if help_text else None,
        html.Div(class_="form-error")[error] if error else None,
    ]

@Component
def TextInput(
    name: str,
    type: Literal["text", "email", "password", "tel", "url"] = "text",
    value: str = "",
    placeholder: str = "",
    required: bool = False,
    disabled: bool = False,
):
    return html.Input(
        type=type,
        id=name,
        name=name,
        value=value,
        placeholder=placeholder,
        required=required,
        disabled=disabled,
        class_="form-input"
    )

@Component
def TextArea(
    name: str,
    value: str = "",
    rows: int = 4,
    placeholder: str = "",
    required: bool = False,
):
    return html.Textarea(
        id=name,
        name=name,
        rows=rows,
        placeholder=placeholder,
        required=required,
        class_="form-textarea"
    )[value]

@Component
def Select(
    name: str,
    options: list[tuple[str, str]],  # [(value, label), ...]
    selected: str = "",
    required: bool = False,
):
    return html.Select(
        id=name,
        name=name,
        required=required,
        class_="form-select"
    )[
        [html.Option(
            value=value,
            selected=(value == selected)
        )[label] for value, label in options]
    ]

@Component
def Checkbox(
    name: str,
    label: str,
    checked: bool = False,
    value: str = "1",
):
    return html.Div(class_="form-checkbox")[
        html.Input(
            type="checkbox",
            id=name,
            name=name,
            value=value,
            checked=checked
        ),
        html.Label(for_=name)[label],
    ]

@Component
def RadioGroup(
    name: str,
    options: list[tuple[str, str]],  # [(value, label), ...]
    selected: str = "",
):
    return html.Div(class_="form-radio-group")[
        [html.Div(class_="form-radio")[
            html.Input(
                type="radio",
                id=f"{name}_{value}",
                name=name,
                value=value,
                checked=(value == selected)
            ),
            html.Label(for_=f"{name}_{value}")[label],
        ] for value, label in options]
    ]

# Usage
registration_form = html.Form(method="post", action="/register")[
    FormGroup(
        label="Email",
        name="email",
        required=True,
        help_text="We'll never share your email"
    )[
        TextInput(name="email", type="email", required=True)
    ],

    FormGroup(
        label="Password",
        name="password",
        required=True,
        help_text="At least 8 characters"
    )[
        TextInput(name="password", type="password", required=True)
    ],

    FormGroup(
        label="Country",
        name="country",
        required=True
    )[
        Select(
            name="country",
            options=[
                ("us", "United States"),
                ("uk", "United Kingdom"),
                ("ca", "Canada"),
            ],
            required=True
        )
    ],

    FormGroup(
        label="Bio",
        name="bio"
    )[
        TextArea(name="bio", placeholder="Tell us about yourself")
    ],

    Checkbox(name="newsletter", label="Subscribe to newsletter"),

    html.Button(type="submit", class_="btn-primary")["Register"],
]
```

## Type-Safe Development

### Type-Safe Component Props

```python
from compone import Component, html
from typing import Literal, TypedDict, Optional
from datetime import datetime

class User(TypedDict):
    id: int
    name: str
    email: str
    avatar_url: Optional[str]
    role: Literal["admin", "user", "guest"]

class Post(TypedDict):
    id: int
    title: str
    content: str
    author: User
    created_at: datetime
    tags: list[str]

@Component
def UserAvatar(
    user: User,
    size: Literal["sm", "md", "lg"] = "md",
):
    sizes = {"sm": "32", "md": "48", "lg": "64"}
    return html.Div(class_=f"avatar avatar-{size}")[
        html.Img(
            src=user["avatar_url"] or "/default-avatar.png",
            alt=user["name"],
            width=sizes[size],
            height=sizes[size]
        ) if user.get("avatar_url") else html.Div(class_="avatar-placeholder")[
            user["name"][0].upper()
        ]
    ]

@Component
def UserBadge(user: User):
    badge_colors = {
        "admin": "red",
        "user": "blue",
        "guest": "gray",
    }
    return html.Span(
        class_=f"badge badge-{badge_colors[user['role']]}"
    )[user["role"].title()]

@Component
def PostCard(post: Post, show_author: bool = True):
    return html.Article(class_="post-card")[
        html.Header[
            html.H2[html.A(href=f"/posts/{post['id']}")[post["title"]]],
            html.Div(class_="post-meta")[
                UserAvatar(post["author"], size="sm") if show_author else None,
                html.Span[post["author"]["name"]] if show_author else None,
                html.Time(datetime=post["created_at"].isoformat())[
                    post["created_at"].strftime("%B %d, %Y")
                ],
            ],
        ],
        html.Div(class_="post-content")[post["content"][:200] + "..."],
        html.Footer[
            html.Div(class_="post-tags")[
                [html.Span(class_="tag")[f"#{tag}"] for tag in post["tags"]]
            ],
            html.A(href=f"/posts/{post['id']}")["Read more →"],
        ],
    ]

# Usage with type checking
user: User = {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "avatar_url": "https://example.com/avatar.jpg",
    "role": "admin",  # IDE will autocomplete and validate
}

post: Post = {
    "id": 1,
    "title": "My First Post",
    "content": "This is the content of my first post...",
    "author": user,
    "created_at": datetime.now(),
    "tags": ["python", "web", "compone"],
}

# Type errors caught by IDE:
# PostCard(post, show_author="yes")  # Error: bool expected, got str
# user["role"] = "superuser"  # Error: Literal type violation
```

### Generic Components with TypeVars

```python
from typing import TypeVar, Generic, Callable
from compone import Component, html

T = TypeVar('T')

@Component
def DataList(
    items: list[T],
    render_item: Callable[[T], any],
    empty_message: str = "No items to display",
    children=None
):
    if not items:
        return html.P(class_="empty-state")[empty_message]

    return html.Div(class_="data-list")[
        [html.Div(class_="data-list-item")[render_item(item)] for item in items],
        children,
    ]

# Usage with type inference
users = [
    {"name": "Alice", "email": "alice@example.com"},
    {"name": "Bob", "email": "bob@example.com"},
]

user_list = DataList(
    items=users,
    render_item=lambda u: html.Div[
        html.Strong[u["name"]],
        html.Span[u["email"]],
    ],
    empty_message="No users found"
)
```


## Real-World Examples

### Complete Blog with Admin Panel

```python
from flask import Flask, request, redirect, session
from compone import Component, html
from typing import Optional

app = Flask(__name__)
app.secret_key = "dev"

# Mock database
posts_db = []
users_db = {"admin": "password"}

@Component
def AdminLayout(title: str, children):
    return html.Html[
        html.Head[
            html.Meta(charset="utf-8"),
            html.Title[f"{title} - Admin"],
            html.Link(rel="stylesheet", href="/static/admin.css"),
        ],
        html.Body[
            html.Header[
                html.H1["Blog Admin"],
                html.Nav[
                    html.A(href="/admin")["Dashboard"],
                    html.A(href="/admin/posts")["Posts"],
                    html.A(href="/logout")["Logout"],
                ],
            ],
            html.Main[children],
        ],
    ]

@Component
def PostEditor(
    post_id: Optional[int] = None,
    title: str = "",
    content: str = "",
):
    action = f"/admin/posts/{post_id}/edit" if post_id else "/admin/posts/create"
    return html.Form(action=action, method="post")[
        html.Div[
            html.Label(for_="title")["Title"],
            html.Input(type="text", id="title", name="title", value=title, required=True),
        ],
        html.Div[
            html.Label(for_="content")["Content"],
            html.Textarea(id="content", name="content", rows=10, required=True)[content],
        ],
        html.Button(type="submit")["Save Post"],
    ]

@app.route("/admin/posts")
def admin_posts():
    if "user" not in session:
        return redirect("/login")

    return str(AdminLayout("Posts")[
        html.H2["All Posts"],
        html.A(href="/admin/posts/new", class_="btn")["New Post"],
        html.Table[
            html.Thead[
                html.Tr[
                    html.Th["Title"],
                    html.Th["Created"],
                    html.Th["Actions"],
                ]
            ],
            html.Tbody[
                [html.Tr[
                    html.Td[post["title"]],
                    html.Td[post["created_at"]],
                    html.Td[
                        html.A(href=f"/admin/posts/{i}/edit")["Edit"],
                        html.Form(
                            action=f"/admin/posts/{i}/delete",
                            method="post",
                            style="display:inline"
                        )[
                            html.Button(type="submit")["Delete"]
                        ],
                    ],
                ] for i, post in enumerate(posts_db)]
            ] if posts_db else html.Tbody[
                html.Tr[html.Td(colspan="3")["No posts yet"]]
            ]
        ],
    ])

@app.route("/admin/posts/new")
def new_post():
    if "user" not in session:
        return redirect("/login")
    return str(AdminLayout("New Post")[
        html.H2["Create New Post"],
        PostEditor(),
    ])

@app.route("/admin/posts/create", methods=["POST"])
def create_post():
    if "user" not in session:
        return redirect("/login")

    posts_db.append({
        "title": request.form["title"],
        "content": request.form["content"],
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
    })
    return redirect("/admin/posts")
```

This comprehensive examples file covers all the requested use cases with practical, working code examples.
