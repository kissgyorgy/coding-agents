#!/usr/bin/env python3
"""Download a full Hacker News thread JSON from Algolia."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ALGOLIA_ITEM_URL = "https://hn.algolia.com/api/v1/items/{item_id}"
USER_AGENT = "coding-agents-hn-sentiment-analysis/1.0"


def parse_hn_item_id(url_or_id: str) -> str:
    """Extract a Hacker News item id from a URL or raw id."""
    value = url_or_id.strip()
    if re.fullmatch(r"\d+", value):
        return value

    parsed = urllib.parse.urlparse(value)
    query = urllib.parse.parse_qs(parsed.query)
    ids = query.get("id")
    if ids and re.fullmatch(r"\d+", ids[0]):
        return ids[0]

    path_match = re.search(r"/(?:item|items)/*(\d+)", parsed.path)
    if path_match:
        return path_match.group(1)

    fallback_match = re.search(r"(?:[?&]id=|/items?/)(\d+)", value)
    if fallback_match:
        return fallback_match.group(1)

    raise ValueError(f"Could not parse Hacker News item id from: {url_or_id}")


def fetch_item(item_id: str) -> dict[str, Any]:
    """Fetch the full nested HN item from Algolia."""
    request = urllib.request.Request(
        ALGOLIA_ITEM_URL.format(item_id=item_id),
        headers={"User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"Algolia returned HTTP {error.code} for item {item_id}"
        ) from error
    except urllib.error.URLError as error:
        raise RuntimeError(
            f"Could not download item {item_id}: {error.reason}"
        ) from error

    data = json.loads(payload)
    if not isinstance(data, dict):
        raise RuntimeError("Algolia returned a non-object JSON response")
    return data


def count_comments(item: dict[str, Any]) -> int:
    """Count nested comment objects under an Algolia HN item."""
    children = item.get("children")
    if not isinstance(children, list):
        return 0

    count = 0
    for child in children:
        if isinstance(child, dict):
            count += 1 + count_comments(child)
    return count


def output_path_for(item_id: str, output: str | None) -> Path:
    if output is not None:
        return Path(output)
    return Path(f"hn-thread-{item_id}.json")


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download full nested Hacker News thread JSON from Algolia.",
    )
    parser.add_argument(
        "url", help="Hacker News item URL, Algolia item URL, or raw HN item id"
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Output JSON file path. Defaults to hn-thread-<id>.json in the current directory.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        item_id = parse_hn_item_id(args.url)
        data = fetch_item(item_id)
        output_path = output_path_for(item_id, args.output)
        write_json(output_path, data)
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    title = data.get("title") or data.get("text") or "(no title)"
    article_url = data.get("url") or "(no article URL)"
    print(f"saved: {output_path}")
    print(f"hn item: {item_id}")
    print(f"title: {title}")
    print(f"article url: {article_url}")
    print(f"comments: {count_comments(data)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
