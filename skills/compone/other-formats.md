# Non-HTML Formats

Compone supports XML, RSS, and custom markup:

```python
from compone import xml

@Component
def RSSItem(title: str, link: str, description: str):
    return xml.Item[
        xml.Title[title],
        xml.Link[link],
        xml.Description[description],
    ]

# Generate RSS feed
feed = xml.Rss(version="2.0")[
    xml.Channel[
        xml.Title["My Blog"],
        RSSItem("Post 1", "https://...", "Description"),
        RSSItem("Post 2", "https://...", "Description"),
    ]
]
```

## XML Module

The `xml` module provides XML element creation.

### Generic XML Elements

```python
from compone import xml

# Create any XML element by attribute access
xml.Root[...]
xml.Item[...]
xml.CustomTag[...]
```

### Common XML Formats

#### RSS Feed Example

```python
xml.Rss(version="2.0")[
    xml.Channel[
        xml.Title["Feed Title"],
        xml.Link["https://example.com"],
        xml.Description["Feed description"],
        xml.Item[
            xml.Title["Item title"],
            xml.Link["https://example.com/item"],
            xml.Description["Item description"],
            xml.PubDate["Mon, 01 Jan 2024 00:00:00 GMT"],
        ],
    ]
]
```

#### Atom Feed Example

```python
xml.Feed(xmlns="http://www.w3.org/2005/Atom")[
    xml.Title["Feed Title"],
    xml.Link(href="https://example.com"),
    xml.Updated["2024-01-01T00:00:00Z"],
    xml.Entry[
        xml.Title["Entry title"],
        xml.Link(href="https://example.com/entry"),
        xml.Updated["2024-01-01T00:00:00Z"],
        xml.Summary["Entry summary"],
    ],
]
```

#### Sitemap Example

```python
xml.Urlset(xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")[
    xml.Url[
        xml.Loc["https://example.com/page1"],
        xml.Lastmod["2024-01-01"],
        xml.Changefreq["weekly"],
        xml.Priority["0.8"],
    ],
]
```

## RSS Feed Generator

```python
from compone import Component, xml
from datetime import datetime
from typing import TypedDict

class RSSItem(TypedDict):
    title: str
    link: str
    description: str
    pub_date: datetime
    author: str
    guid: str

@Component
def RSS_Item(item: RSSItem):
    return xml.Item[
        xml.Title[item["title"]],
        xml.Link[item["link"]],
        xml.Description[item["description"]],
        xml.PubDate[item["pub_date"].strftime("%a, %d %b %Y %H:%M:%S %z")],
        xml.Author[item["author"]],
        xml.Guid(isPermaLink="true")[item["guid"]],
    ]

@Component
def RSS_Feed(
    title: str,
    link: str,
    description: str,
    items: list[RSSItem],
):
    return xml.Rss(version="2.0", xmlns_atom="http://www.w3.org/2005/Atom")[
        xml.Channel[
            xml.Title[title],
            xml.Link[link],
            xml.Description[description],
            xml.Language["en-us"],
            xml.LastBuildDate[datetime.now().strftime("%a, %d %b %Y %H:%M:%S %z")],
            xml.Atom_link(
                href=f"{link}/rss.xml",
                rel="self",
                type="application/rss+xml"
            ),
            [RSS_Item(item) for item in items],
        ]
    ]

# Usage
blog_items = [
    {
        "title": "First Blog Post",
        "link": "https://example.com/posts/1",
        "description": "This is my first blog post about Python",
        "pub_date": datetime(2024, 1, 1, 12, 0, 0),
        "author": "john@example.com (John Doe)",
        "guid": "https://example.com/posts/1",
    },
    {
        "title": "Second Blog Post",
        "link": "https://example.com/posts/2",
        "description": "Another great post about web development",
        "pub_date": datetime(2024, 1, 5, 14, 30, 0),
        "author": "john@example.com (John Doe)",
        "guid": "https://example.com/posts/2",
    },
]

feed = RSS_Feed(
    title="My Blog",
    link="https://example.com",
    description="A blog about Python and web development",
    items=blog_items
)

print('<?xml version="1.0" encoding="UTF-8"?>')
print(str(feed))
```

## Sitemap Generator

```python
from compone import Component, xml
from datetime import datetime
from typing import Literal

ChangeFreq = Literal["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]

@Component
def URL(
    loc: str,
    lastmod: datetime,
    changefreq: ChangeFreq = "weekly",
    priority: float = 0.5,
):
    return xml.Url[
        xml.Loc[loc],
        xml.Lastmod[lastmod.strftime("%Y-%m-%d")],
        xml.Changefreq[changefreq],
        xml.Priority[f"{priority:.1f}"],
    ]

@Component
def Sitemap(urls: list[dict]):
    return xml.Urlset(xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")[
        [URL(
            loc=url["loc"],
            lastmod=url["lastmod"],
            changefreq=url.get("changefreq", "weekly"),
            priority=url.get("priority", 0.5),
        ) for url in urls]
    ]

# Usage
pages = [
    {
        "loc": "https://example.com/",
        "lastmod": datetime(2024, 1, 1),
        "changefreq": "daily",
        "priority": 1.0,
    },
    {
        "loc": "https://example.com/about",
        "lastmod": datetime(2024, 1, 1),
        "changefreq": "monthly",
        "priority": 0.8,
    },
    {
        "loc": "https://example.com/blog",
        "lastmod": datetime(2024, 1, 10),
        "changefreq": "weekly",
        "priority": 0.9,
    },
]

sitemap = Sitemap(pages)
print('<?xml version="1.0" encoding="UTF-8"?>')
print(str(sitemap))
```

## SVG Generation

```python
from compone import Component
from compone import xml  # SVG uses xml module

@Component
def Circle(cx: int, cy: int, r: int, fill: str = "black"):
    return xml.Circle(cx=str(cx), cy=str(cy), r=str(r), fill=fill)

@Component
def Rect(x: int, y: int, width: int, height: int, fill: str = "black"):
    return xml.Rect(
        x=str(x),
        y=str(y),
        width=str(width),
        height=str(height),
        fill=fill
    )

@Component
def SVG(width: int, height: int, children):
    return xml.Svg(
        width=str(width),
        height=str(height),
        xmlns="http://www.w3.org/2000/svg"
    )[children]

# Create a simple graphic
graphic = SVG(200, 200)[
    Rect(0, 0, 200, 200, fill="#f0f0f0"),
    Circle(100, 100, 50, fill="#ff6b6b"),
    Circle(70, 80, 10, fill="white"),
    Circle(130, 80, 10, fill="white"),
]

print(str(graphic))
```
