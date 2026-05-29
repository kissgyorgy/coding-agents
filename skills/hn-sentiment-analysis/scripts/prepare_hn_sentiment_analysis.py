#!/usr/bin/env python3
"""Prepare Hacker News thread artifacts for sentiment analysis."""

from __future__ import annotations

import argparse
import collections
import html
import json
import re
import sys
import textwrap
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from download_hn_thread import fetch_item, parse_hn_item_id, write_json

HN_ITEM_URL = "https://news.ycombinator.com/item?id={item_id}"
DEFAULT_CHUNK_CHARS = 35_000
DEFAULT_REVIEW_PACK_CHARS = 40_000
DEFAULT_TOP_SUBTHREADS = 20
SNIPPET_LENGTH = 220
COMPACT_SNIPPET_LENGTH = 300
LONG_EXCERPT_LENGTH = 1_600
AUTHOR_INDEX_LIMIT = 80
KEY_PERSON_CANDIDATE_LIMIT = 40
REVIEW_PACK_SUBTHREADS = 15
REVIEW_PACK_KEY_PEOPLE = 12
REVIEW_PACK_AUTHORS = 20
REVIEW_PACK_BREADTH_SAMPLE = 24
REVIEW_PACK_CUE_EXAMPLES = 8

TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9_+#./-]{2,}")
STOP_WORDS = frozenset(
    """
    about above after again against all also and any are aren't because been before
    being between both but can can't cannot could couldn't did didn't does doesn't
    doing don't down during each few for from further had hadn't has hasn't have
    haven't having her here here's hers herself him himself his how how's into its
    itself just like more most mustn't nor not off once only other ought our ours
    ourselves out over own same shan't she she's should shouldn't some such than
    that that's the their theirs them themselves then there there's these they
    they'd they'll they're they've this those through too under until very was
    wasn't were weren't what what's when when's where where's which while who
    who's whom why why's with won't would wouldn't you you'd you'll you're you've
    your yours yourself yourselves
    """.split()
)

KEY_PERSON_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "self-identifies as author/builder",
        re.compile(
            r"\b(?:i|we)\s+(?:wrote|built|made|created|launched|released|published|implemented)\b"
            r"|\b(?:i am|i'm|we are|we're)\s+(?:the\s+)?(?:author|creator|developer|maintainer)\b"
            r"|\bas\s+(?:the\s+)?(?:author|creator|developer|maintainer)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "maintainer/core contributor",
        re.compile(
            r"\bmaintain(?:er|ers|ing)?\b|\bcore\s+(?:dev|developer|contributor|team)\b"
            r"|\b(?:my|our)\s+(?:library|package|project|repo|repository)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "founder/executive",
        re.compile(
            r"\b(?:founder|co[- ]?founder|ceo|cto|cio|cpo|coo|vp\s+of|head\s+of)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "employee/project insider",
        re.compile(
            r"\b(?:i|we)\s+(?:work|worked)\s+(?:at|on|for)\b"
            r"|\b(?:my|our)\s+(?:team|company|startup|employer|product|service)\b"
            r"|\bwe(?:'re| are)\s+(?:building|working on|shipping|launching|trying)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "article participant",
        re.compile(
            r"\b(?:i was|we were)\s+(?:quoted|interviewed|mentioned)\b"
            r"|\b(?:my|our)\s+(?:post|article|blog post|writeup|paper)\b",
            re.IGNORECASE,
        ),
    ),
)

CUE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "positive/praise cue examples",
        re.compile(
            r"\b(?:great|excellent|love|loved|awesome|good|useful|impressive|excited|promising|refreshing|agree|right|solid|nice)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "negative/criticism cue examples",
        re.compile(
            r"\b(?:bad|terrible|awful|hate|hated|broken|worse|worst|concern|concerned|skeptical|problem|issue|risk|danger|scam|wrong|misleading|disappointed)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "uncertainty/qualification cue examples",
        re.compile(
            r"\b(?:maybe|perhaps|unclear|unsure|depends|however|although|but|caveat|tradeoff|on the other hand)\b",
            re.IGNORECASE,
        ),
    ),
)


@dataclass(frozen=True)
class CommentRecord:
    order: int
    id: int
    parent_id: int | None
    root_id: int
    depth: int
    path: tuple[int, ...]
    author: str
    created_at: str
    text: str
    direct_replies: int
    total_replies: int
    url: str
    key_person_flags: tuple[str, ...]

    def to_json_object(self) -> dict[str, Any]:
        return {
            "order": self.order,
            "id": self.id,
            "parent_id": self.parent_id,
            "root_id": self.root_id,
            "depth": self.depth,
            "path": list(self.path),
            "author": self.author,
            "created_at": self.created_at,
            "text": self.text,
            "direct_replies": self.direct_replies,
            "total_replies": self.total_replies,
            "url": self.url,
            "key_person_flags": list(self.key_person_flags),
        }


class HnHtmlToText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.link_hrefs: list[str | None] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"p", "div", "blockquote", "pre", "li"}:
            self.parts.append("\n\n")
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "a":
            href = None
            for name, value in attrs:
                if name == "href":
                    href = value
                    break
            self.link_hrefs.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.link_hrefs:
            href = self.link_hrefs.pop()
            if href:
                self.parts.append(f" ({href})")
        elif tag in {"p", "div", "blockquote", "pre", "li"}:
            self.parts.append("\n\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        return normalize_text("".join(self.parts))


def normalize_text(text: str) -> str:
    unescaped = html.unescape(text).replace("\r\n", "\n").replace("\r", "\n")
    unescaped = re.sub(r"[ \t]+", " ", unescaped)
    unescaped = re.sub(r"\n[ \t]+", "\n", unescaped)
    unescaped = re.sub(r"\n{3,}", "\n\n", unescaped)
    return unescaped.strip()


def html_to_text(value: object) -> str:
    if value is None:
        return ""
    parser = HnHtmlToText()
    parser.feed(str(value))
    parser.close()
    return parser.text()


def int_or_none(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def string_value(value: object, fallback: str = "") -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def children_of(item: dict[str, Any]) -> list[dict[str, Any]]:
    children = item.get("children")
    if not isinstance(children, list):
        return []
    return [child for child in children if isinstance(child, dict)]


def count_descendant_comments(items: list[dict[str, Any]]) -> int:
    total = 0
    for item in items:
        if int_or_none(item.get("id")) is None:
            continue
        total += 1 + count_descendant_comments(children_of(item))
    return total


def key_person_flags_for(text: str) -> tuple[str, ...]:
    return tuple(
        label for label, pattern in KEY_PERSON_PATTERNS if pattern.search(text)
    )


def flatten_comments(thread: dict[str, Any]) -> list[CommentRecord]:
    records: list[CommentRecord] = []

    def walk(
        item: dict[str, Any],
        parent_id: int | None,
        root_id: int | None,
        depth: int,
        parent_path: tuple[int, ...],
    ) -> None:
        comment_id = int_or_none(item.get("id"))
        if comment_id is None:
            return

        child_items = children_of(item)
        current_root_id = root_id if root_id is not None else comment_id
        current_path = (*parent_path, comment_id)
        text = html_to_text(item.get("text"))
        author = string_value(item.get("author"), "[deleted]")
        record = CommentRecord(
            order=len(records) + 1,
            id=comment_id,
            parent_id=parent_id,
            root_id=current_root_id,
            depth=depth,
            path=current_path,
            author=author,
            created_at=string_value(item.get("created_at")),
            text=text,
            direct_replies=len(
                [
                    child
                    for child in child_items
                    if int_or_none(child.get("id")) is not None
                ]
            ),
            total_replies=count_descendant_comments(child_items),
            url=HN_ITEM_URL.format(item_id=comment_id),
            key_person_flags=key_person_flags_for(text),
        )
        records.append(record)

        for child in child_items:
            walk(child, comment_id, current_root_id, depth + 1, current_path)

    for child in children_of(thread):
        walk(child, None, None, 0, ())

    return records


def visible_comments(records: list[CommentRecord]) -> list[CommentRecord]:
    return [record for record in records if record.text]


def truncate(text: str, max_length: int) -> str:
    if len(text) <= max_length:
        return text
    return text[: max_length - 1].rstrip() + "…"


def snippet(text: str, max_length: int = SNIPPET_LENGTH) -> str:
    return truncate(" ".join(text.split()), max_length)


def markdown_escape(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def story_id(thread: dict[str, Any]) -> str:
    item_id = int_or_none(thread.get("id"))
    if item_id is not None:
        return str(item_id)
    object_id = thread.get("objectID")
    if isinstance(object_id, str) and object_id.isdigit():
        return object_id
    raise ValueError("Could not determine HN item id from thread JSON")


def story_title(thread: dict[str, Any]) -> str:
    return string_value(thread.get("title"), "(no title)")


def story_url(thread: dict[str, Any]) -> str:
    return string_value(thread.get("url"), "")


def story_text(thread: dict[str, Any]) -> str:
    return html_to_text(thread.get("text"))


def story_points(thread: dict[str, Any]) -> str:
    points = thread.get("points")
    if isinstance(points, int):
        return str(points)
    return "unknown"


def load_or_download_thread(source: str) -> dict[str, Any]:
    path = Path(source)
    if path.exists() and path.is_file():
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise ValueError(f"Expected JSON object in {path}")
        return loaded

    return fetch_item(parse_hn_item_id(source))


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def bounded_markdown(lines: list[str], max_chars: int) -> str:
    content = "\n".join(lines).rstrip() + "\n"
    if len(content) <= max_chars:
        return content

    marker = (
        "\n\n[Truncated to the configured review-pack budget. Use targeted "
        "artifacts for more detail; do not read every chunk.]\n"
    )
    if max_chars <= len(marker):
        return marker.lstrip()

    truncated = content[: max_chars - len(marker)].rstrip()
    if "\n" in truncated:
        truncated = truncated.rsplit("\n", 1)[0]
    return truncated + marker


def render_comment(record: CommentRecord) -> str:
    flags = ", ".join(record.key_person_flags) if record.key_person_flags else "none"
    return textwrap.dedent(
        f"""
        ## Comment lookup {lookup_label(record)} by {record.author}

        - Created: {record.created_at or "unknown"}
        - Depth: {record.depth}
        - Direct replies: {record.direct_replies}
        - Total nested replies: {record.total_replies}
        - Key-person heuristic flags: {flags}

        {record.text}
        """
    ).strip()


def lookup_label(record: CommentRecord) -> str:
    return f"C{record.order}"


def compact_comment(
    record: CommentRecord, max_length: int = COMPACT_SNIPPET_LENGTH
) -> str:
    flags = ""
    if record.key_person_flags:
        flags = f" flags={', '.join(record.key_person_flags)}"
    return (
        f"- @{record.author} depth={record.depth} "
        f"replies={record.total_replies}{flags}: "
        f"{snippet(record.text, max_length)}"
    )


def write_story_file(
    output_dir: Path, thread: dict[str, Any], records: list[CommentRecord]
) -> None:
    url = story_url(thread)
    text = story_text(thread)
    visible_count = len(visible_comments(records))
    total_count = len(records)
    content = textwrap.dedent(
        f"""
        # HN story: {story_title(thread)}

        - HN source: Hacker News thread; raw item id intentionally omitted from human-facing artifacts
        - Article URL: {url or "(none; use story text if present)"}
        - Submitter: {string_value(thread.get("author"), "unknown")}
        - Created: {string_value(thread.get("created_at"), "unknown")}
        - Points: {story_points(thread)}
        - Algolia comment count field: {thread.get("children_count", "unknown")}
        - Parsed comments: {total_count}
        - Parsed visible comments with text: {visible_count}

        ## HN story text

        {text or "(no HN story text)"}
        """
    )
    write_text(output_dir / "story.md", content)


def write_comments_jsonl(output_dir: Path, records: list[CommentRecord]) -> None:
    path = output_dir / "comments.jsonl"
    lines = [
        json.dumps(record.to_json_object(), ensure_ascii=False) for record in records
    ]
    write_text(path, "\n".join(lines))


def record_chunks(
    records: list[CommentRecord], max_chars: int
) -> list[list[CommentRecord]]:
    chunks: list[list[CommentRecord]] = []
    current: list[CommentRecord] = []
    current_size = 0

    for record in records:
        rendered_size = len(render_comment(record)) + 2
        if current and current_size + rendered_size > max_chars:
            chunks.append(current)
            current = []
            current_size = 0
        current.append(record)
        current_size += rendered_size

    if current:
        chunks.append(current)
    return chunks


def chunk_filename(index: int) -> str:
    return f"chunks/comments-{index:03d}.md"


def write_comment_chunks(
    output_dir: Path, records: list[CommentRecord], max_chars: int
) -> list[list[CommentRecord]]:
    chunks = record_chunks(records, max_chars)
    chunks_dir = output_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    total = len(chunks)

    for index, chunk in enumerate(chunks, start=1):
        content = textwrap.dedent(
            f"""
            # HN comments chunk {index}/{total}

            Reference only. Do not read every chunk. Use `chunk-index.md` to pick a specific chunk when the review pack lacks enough detail.
            """
        ).strip()
        content += "\n\n" + "\n\n---\n\n".join(
            render_comment(record) for record in chunk
        )
        write_text(output_dir / chunk_filename(index), content)

    return chunks


def write_chunk_index(output_dir: Path, chunks: list[list[CommentRecord]]) -> None:
    sections = [
        "# HN comment chunk index",
        "",
        "Use this only for targeted lookup. Do not read all chunks into context.",
        "",
        "| Chunk | Comments | Lookup range | Lookup refs | Top roots | Authors |",
        "| --- | ---: | --- | --- | --- | --- |",
    ]
    for index, chunk in enumerate(chunks, start=1):
        roots = collections.Counter(record.root_id for record in chunk)
        authors = collections.Counter(record.author for record in chunk)
        comment_refs = ", ".join(lookup_label(record) for record in chunk[:8])
        if len(chunk) > 8:
            comment_refs += ", …"
        root_summary = ", ".join(
            f"root-{index + 1}({count})"
            for index, (_root, count) in enumerate(roots.most_common(6))
        )
        author_summary = ", ".join(
            f"{markdown_escape(author)}({count})"
            for author, count in authors.most_common(6)
        )
        sections.append(
            f"| `{chunk_filename(index)}` | {len(chunk)} | "
            f"{lookup_label(chunk[0])}–{lookup_label(chunk[-1])} | {comment_refs} | "
            f"{root_summary} | {author_summary} |"
        )

    write_text(output_dir / "chunk-index.md", "\n".join(sections))


def records_by_parent(
    records: list[CommentRecord],
) -> dict[int | None, list[CommentRecord]]:
    grouped: dict[int | None, list[CommentRecord]] = collections.defaultdict(list)
    for record in records:
        grouped[record.parent_id].append(record)
    return grouped


def unique_records(records: list[CommentRecord]) -> list[CommentRecord]:
    seen: set[int] = set()
    unique: list[CommentRecord] = []
    for record in records:
        if record.id in seen:
            continue
        seen.add(record.id)
        unique.append(record)
    return unique


def quantile_sample(records: list[CommentRecord], limit: int) -> list[CommentRecord]:
    if limit <= 0 or not records:
        return []
    if len(records) <= limit:
        return records
    if limit == 1:
        return [records[0]]

    indexes = [
        round(index * (len(records) - 1) / (limit - 1)) for index in range(limit)
    ]
    return [records[index] for index in indexes]


def tokens_for(text: str) -> list[str]:
    tokens: list[str] = []
    for raw_token in TOKEN_RE.findall(text.lower()):
        token = raw_token.strip("._-/#")
        if len(token) < 3 or token in STOP_WORDS or token.isdigit():
            continue
        tokens.append(token)
    return tokens


def top_terms(records: list[CommentRecord], limit: int) -> list[tuple[str, int]]:
    counter: collections.Counter[str] = collections.Counter()
    for record in records:
        counter.update(tokens_for(record.text))
    return counter.most_common(limit)


def top_bigrams(records: list[CommentRecord], limit: int) -> list[tuple[str, int]]:
    counter: collections.Counter[str] = collections.Counter()
    for record in records:
        tokens = tokens_for(record.text)
        counter.update(
            f"{left} {right}"
            for left, right in zip(tokens, tokens[1:])
            if left != right
        )
    return counter.most_common(limit)


def cue_examples(
    records: list[CommentRecord], pattern: re.Pattern[str], limit: int
) -> list[CommentRecord]:
    matches = [record for record in records if pattern.search(record.text)]
    matches.sort(key=lambda record: (-record.total_replies, record.order))
    return matches[:limit]


def write_review_pack(
    output_dir: Path,
    thread: dict[str, Any],
    records: list[CommentRecord],
    max_chars: int,
) -> None:
    visible = visible_comments(records)
    children = records_by_parent(records)
    top_level = [record for record in visible if record.depth == 0]
    top_level.sort(key=lambda record: record.total_replies, reverse=True)
    key_candidates = [record for record in visible if record.key_person_flags]
    key_candidates.sort(
        key=lambda record: (
            -len(record.key_person_flags),
            -record.total_replies,
            record.order,
        )
    )
    author_counts = collections.Counter(record.author for record in visible)

    lines = [
        f"# HN sentiment review pack: {story_title(thread)}",
        "",
        "This is the bounded primary artifact for sentiment analysis. Read this before any larger artifact.",
        "Do not read `thread.json`, `comments.jsonl`, or every file in `chunks/`; use targeted lookup only.",
        "Internal lookup labels and raw HN IDs are for analysis only; do not include them in the final human report.",
        "",
        "## Story metadata",
        "",
        "- HN source: Hacker News thread; raw item id intentionally omitted from the report",
        f"- Article URL: {story_url(thread) or '(none)'}",
        f"- Submitter: {string_value(thread.get('author'), 'unknown')}",
        f"- Points: {story_points(thread)}",
        f"- Visible comments prepared: {len(visible)}",
        "",
        "## Comment topic hints",
        "",
        "These are mechanical frequency hints, not conclusions.",
        "",
        "Top terms: "
        + ", ".join(f"{term} ({count})" for term, count in top_terms(visible, 30)),
        "",
        "Top bigrams: "
        + ", ".join(f"{term} ({count})" for term, count in top_bigrams(visible, 20)),
        "",
        "## Prolific authors",
        "",
        "Use this to avoid over-counting one prolific author as many independent votes.",
    ]

    for author, count in author_counts.most_common(REVIEW_PACK_AUTHORS):
        distinct_roots = len(
            {record.root_id for record in visible if record.author == author}
        )
        lines.append(
            f"- @{author}: {count} comments across {distinct_roots} top-level subthreads"
        )

    lines.extend(
        [
            "",
            "## Key-person candidates",
            "",
            "Heuristic matches only. Verify from context before treating anyone as an insider.",
        ]
    )
    if not key_candidates:
        lines.append("- No key-person candidates found by heuristics.")
    for record in key_candidates[:REVIEW_PACK_KEY_PEOPLE]:
        lines.append(compact_comment(record, 360))

    lines.extend(
        [
            "",
            "## Most engaged top-level subthreads",
            "",
            "Sorted by nested reply count. Engagement is not a vote tally.",
        ]
    )
    for record in top_level[:REVIEW_PACK_SUBTHREADS]:
        lines.append("")
        lines.append(compact_comment(record, 420))
        direct_replies = [reply for reply in children.get(record.id, []) if reply.text]
        direct_replies.sort(key=lambda reply: (-reply.total_replies, reply.order))
        for reply in direct_replies[:3]:
            lines.append("  " + compact_comment(reply, 220))

    breadth_candidates = unique_records(
        quantile_sample(visible, REVIEW_PACK_BREADTH_SAMPLE)
        + sorted(
            [record for record in visible if record.depth >= 2],
            key=lambda record: (-record.total_replies, record.order),
        )[:8]
        + [record for record in top_level if record.total_replies == 0][:8]
    )
    lines.extend(
        [
            "",
            "## Breadth sample",
            "",
            "Stratified mechanical sample to reduce top-subthread bias.",
        ]
    )
    for record in breadth_candidates[: REVIEW_PACK_BREADTH_SAMPLE + 16]:
        lines.append(compact_comment(record, 260))

    lines.extend(
        [
            "",
            "## Lexical cue samples",
            "",
            "Cue samples are places to inspect, not sentiment counts or classifier output.",
        ]
    )
    for label, pattern in CUE_PATTERNS:
        lines.extend(["", f"### {label}", ""])
        examples = cue_examples(visible, pattern, REVIEW_PACK_CUE_EXAMPLES)
        if not examples:
            lines.append("- No examples found.")
        for record in examples:
            lines.append(compact_comment(record, 240))

    write_text(output_dir / "review-pack.md", bounded_markdown(lines, max_chars))


def write_top_subthreads(
    output_dir: Path, records: list[CommentRecord], top_subthreads: int
) -> None:
    by_id = {record.id: record for record in records}
    top_level = [record for record in visible_comments(records) if record.depth == 0]
    top_level.sort(key=lambda record: record.total_replies, reverse=True)

    sections = [
        "# Top engaged HN subthreads",
        "",
        "Sorted by nested reply count. Use this for targeted detail after reading `review-pack.md`; do not treat reply count as a vote tally.",
    ]

    for record in top_level[:top_subthreads]:
        child_replies = [
            reply for reply in records if reply.parent_id == record.id and reply.text
        ]
        child_replies.sort(key=lambda reply: reply.total_replies, reverse=True)
        sections.extend(
            [
                "",
                f"## Top-level comment lookup {lookup_label(record)} by {record.author}",
                "",
                f"- Total nested replies: {record.total_replies}",
                f"- Key-person heuristic flags: {', '.join(record.key_person_flags) or 'none'}",
                "",
                truncate(record.text, LONG_EXCERPT_LENGTH),
            ]
        )
        if child_replies:
            sections.extend(["", "Most engaged direct replies:"])
            for reply in child_replies[:5]:
                parent = (
                    by_id.get(reply.parent_id) if reply.parent_id is not None else None
                )
                parent_author = parent.author if parent is not None else "unknown"
                sections.append(
                    f"- {lookup_label(reply)} by {reply.author}, replying to {parent_author}: "
                    f"{reply.total_replies} nested replies — {snippet(reply.text)}"
                )

    write_text(output_dir / "top-subthreads.md", "\n".join(sections))


def write_author_index(output_dir: Path, records: list[CommentRecord]) -> None:
    grouped: dict[str, list[CommentRecord]] = collections.defaultdict(list)
    for record in visible_comments(records):
        grouped[record.author].append(record)

    rows = sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0].lower()))
    sections = [
        "# HN author index",
        "",
        f"Top {AUTHOR_INDEX_LIMIT} authors by visible comment count. Multiple comments from one author should not be counted as independent sentiment votes.",
        "",
        "| Author | Comments | Distinct top-level subthreads | Key-person flags | Lookup snippets |",
        "| --- | ---: | ---: | --- | --- |",
    ]

    for author, author_records in rows[:AUTHOR_INDEX_LIMIT]:
        roots = {record.root_id for record in author_records}
        flags = sorted(
            {flag for record in author_records for flag in record.key_person_flags}
        )
        examples = "; ".join(
            f"{lookup_label(record)}: {markdown_escape(snippet(record.text, 90))}"
            for record in author_records[:3]
        )
        sections.append(
            f"| {markdown_escape(author)} | {len(author_records)} | {len(roots)} | "
            f"{markdown_escape(', '.join(flags) or 'none')} | {markdown_escape(examples)} |"
        )

    write_text(output_dir / "author-index.md", "\n".join(sections))


def write_key_person_candidates(output_dir: Path, records: list[CommentRecord]) -> None:
    by_id = {record.id: record for record in records}
    candidates = [
        record for record in visible_comments(records) if record.key_person_flags
    ]
    candidates.sort(
        key=lambda record: (
            -len(record.key_person_flags),
            -record.total_replies,
            record.author,
        )
    )

    sections = [
        "# Key-person candidates",
        "",
        f"Top {KEY_PERSON_CANDIDATE_LIMIT} heuristic matches only. Verify from context before treating anyone as an author, maintainer, employee, founder, or executive.",
    ]

    if not candidates:
        sections.extend(["", "No heuristic key-person candidates found."])
    for record in candidates[:KEY_PERSON_CANDIDATE_LIMIT]:
        parent = by_id.get(record.parent_id) if record.parent_id is not None else None
        sections.extend(
            [
                "",
                f"## Comment lookup {lookup_label(record)} by {record.author}",
                "",
                f"- Flags: {', '.join(record.key_person_flags)}",
                f"- Total nested replies: {record.total_replies}",
                f"- Root top-level comment: {lookup_label(by_id[record.root_id]) if record.root_id in by_id else 'unknown'}",
            ]
        )
        if parent is not None:
            sections.extend(
                [
                    f"- Parent comment: {lookup_label(parent)} by {parent.author}",
                    "",
                    f"Parent excerpt: {snippet(parent.text, 400)}",
                ]
            )
        sections.extend(["", truncate(record.text, LONG_EXCERPT_LENGTH)])

    write_text(output_dir / "key-person-candidates.md", "\n".join(sections))


def write_sentiment_worksheet(output_dir: Path) -> None:
    content = textwrap.dedent(
        """
        # Sentiment analysis worksheet

        Use this as the mental checklist for the final answer. Do not fill this file unless the user explicitly asks for a saved report.

        ## Evidence rules

        - Start from `review-pack.md`; do not read every chunk.
        - Base claims on comment text, authors, roles, and subthread context from the generated artifacts.
        - Distinguish sentiment toward the article, the underlying topic, the product/company/project, and HN meta-discussion.
        - Do not treat reply count as a vote count; use it as engagement/context only.
        - Avoid over-counting repeated comments by the same author.
        - Separate substantive criticism from jokes, tangents, ideology, and bikeshedding.
        - Note uncertainty when comments are ambiguous, sarcastic, or based on partial article reading.
        - Remember HN audience bias: technical, startup-heavy, and not representative of the general public.

        ## Suggested labels

        - Overall: positive / negative / mixed-positive / mixed-negative / polarized / neutral / unclear.
        - Confidence: high / medium / low, based on visible comment count, agreement concentration, and ambiguity.

        ## Final answer outline

        1. Article summary.
        2. Overall HN sentiment with confidence.
        3. Main opinion groups by theme, with representative authors or short quote snippets.
        4. Key people and what they said, grouped by subthread.
        5. Notable minority views, disagreements, and caveats.
        """
    )
    write_text(output_dir / "sentiment-worksheet.md", content)


def write_analysis_brief(
    output_dir: Path,
    thread: dict[str, Any],
    records: list[CommentRecord],
    chunk_count: int,
) -> None:
    visible_count = len(visible_comments(records))
    candidate_count = len(
        [record for record in records if record.key_person_flags and record.text]
    )
    content = textwrap.dedent(
        f"""
        # HN sentiment analysis brief

        - Story: {story_title(thread)}
        - HN source: Hacker News thread; raw item id intentionally omitted from the report
        - Article URL: {story_url(thread) or "(none)"}
        - Output directory: `{output_dir}`
        - Primary bounded artifact: `review-pack.md`
        - Raw Algolia JSON: `thread.json` (do not read by default)
        - Visible comments prepared: {visible_count}
        - Comment chunks: {chunk_count} (targeted lookup only)
        - Key-person heuristic candidates: {candidate_count}

        ## Required reading order

        1. `story.md` for metadata and article URL.
        2. Fetch and summarize the article URL if present.
        3. `review-pack.md` for the bounded sentiment evidence pack.
        4. `sentiment-worksheet.md` for quality rules and final answer outline.
        5. Optional targeted detail only if needed: `top-subthreads.md`, `key-person-candidates.md`, `author-index.md`, then `chunk-index.md` to choose one specific `chunks/comments-*.md` file.

        ## Important constraints

        Do not read `thread.json`, `comments.jsonl`, or every `chunks/comments-*.md` file into context. Do not write any additional scripts, one-off parsers, or ad-hoc data-processing code for this analysis. Do not include raw HN item IDs, comment IDs, thread IDs, naked HN URLs, or internal lookup labels in the final human report. The generated artifacts are the intended analysis surface. If you need a different chunk size, review-pack budget, or output directory, rerun `prepare_hn_sentiment_analysis.py` with flags instead of creating a new script.

        ## Quality bar

        A good analysis separates article summary from comment sentiment, groups opinions by topic, identifies who is speaking when possible, uses representative authors or short quotes instead of raw IDs, reports minority views, and states uncertainty instead of forcing a single sentiment label.
        """
    )
    write_text(output_dir / "analysis-brief.md", content)


def prepare_artifacts(
    thread: dict[str, Any],
    output_dir: Path,
    chunk_chars: int,
    top_subthreads: int,
    review_chars: int,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    records = flatten_comments(thread)
    visible = visible_comments(records)
    item_id = story_id(thread)

    write_json(output_dir / "thread.json", thread)
    write_story_file(output_dir, thread, records)
    write_comments_jsonl(output_dir, visible)
    chunks = write_comment_chunks(output_dir, visible, chunk_chars)
    write_chunk_index(output_dir, chunks)
    write_review_pack(output_dir, thread, records, review_chars)
    write_top_subthreads(output_dir, records, top_subthreads)
    write_author_index(output_dir, records)
    write_key_person_candidates(output_dir, records)
    write_sentiment_worksheet(output_dir)
    write_analysis_brief(output_dir, thread, records, len(chunks))
    write_text(output_dir / "item-id.txt", item_id)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download or load a Hacker News thread and prepare sentiment-analysis artifacts.",
    )
    parser.add_argument(
        "source",
        help="Hacker News URL, Algolia item URL, raw HN item id, or existing thread JSON file.",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        help="Output directory. Defaults to hn-sentiment-<item-id>.",
    )
    parser.add_argument(
        "--chunk-chars",
        type=int,
        default=DEFAULT_CHUNK_CHARS,
        help=f"Approximate maximum characters per targeted lookup chunk. Default: {DEFAULT_CHUNK_CHARS}.",
    )
    parser.add_argument(
        "--review-chars",
        type=int,
        default=DEFAULT_REVIEW_PACK_CHARS,
        help=f"Maximum characters for the bounded review pack. Default: {DEFAULT_REVIEW_PACK_CHARS}.",
    )
    parser.add_argument(
        "--top-subthreads",
        type=int,
        default=DEFAULT_TOP_SUBTHREADS,
        help=f"Number of engaged top-level subthreads to include. Default: {DEFAULT_TOP_SUBTHREADS}.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        thread = load_or_download_thread(args.source)
        item_id = story_id(thread)
        output_dir = (
            Path(args.output_dir)
            if args.output_dir
            else Path(f"hn-sentiment-{item_id}")
        )
        prepare_artifacts(
            thread,
            output_dir,
            args.chunk_chars,
            args.top_subthreads,
            args.review_chars,
        )
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(f"saved analysis artifacts: {output_dir}")
    print(f"start with: {output_dir / 'analysis-brief.md'}")
    print(f"primary bounded artifact: {output_dir / 'review-pack.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
