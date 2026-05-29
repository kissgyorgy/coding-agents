---
name: hn-sentiment-analysis
description: Analyze Hacker News thread sentiment from a provided HN thread URL.
allowed-tools: Fetch, Bash, Read
disable-model-invocation: true
---

# Hacker News Sentiment Analysis

Analyze a Hacker News thread URL provided through `/skill:hn-sentiment-analysis`.

## Non-negotiable rules

- Do not write any additional scripts, one-off parsers, notebooks, or ad-hoc data-processing code for this task. The scripts in this skill are the complete analysis pipeline.
- Do not read `thread.json`, `comments.jsonl`, or every `chunks/comments-*.md` file into context. Large HN threads will overflow the model context.
- Do not include raw HN item IDs, comment IDs, thread IDs, naked HN URLs, or internal lookup labels in the human-facing final report. Use author names, roles, themes, and short quote snippets instead.
- If you need a different output directory, review-pack size, or chunk size, rerun the provided script with flags instead of creating new code.

## Workflow

1. Prepare the HN thread artifacts with the provided pipeline:

   ```bash
   python skills/hn-sentiment-analysis/scripts/prepare_hn_sentiment_analysis.py 'https://news.ycombinator.com/item?id=12345678'
   ```

   The script parses the HN item id, downloads the full nested thread JSON from Algolia, saves it, flattens comments, creates targeted lookup chunks, and generates a bounded `review-pack.md` for analysis.

2. Read the generated `analysis-brief.md` first. Follow its reading order.
3. Read `story.md`, fetch the article URL with the `fetch` tool, and write a very short article summary. If there is no article URL, summarize the HN story text.
4. Read `review-pack.md`. This is the primary bounded evidence pack for sentiment analysis.
5. Read `sentiment-worksheet.md` as the quality checklist.
6. Only if needed, read targeted detail files:
   - `top-subthreads.md` for more detail on engaged subthreads.
   - `key-person-candidates.md` for possible insiders/authors/maintainers/executives.
   - `author-index.md` to avoid over-counting prolific authors.
   - `chunk-index.md` to choose one specific `chunks/comments-*.md` file for a targeted lookup.

## Quality requirements

A good sentiment analysis must:

- Separate the article summary from HN commenter sentiment.
- Distinguish sentiment toward the article, topic, product/company/project, implementation details, and HN meta-discussion.
- Group opinions by theme, not only by positive/negative polarity.
- Support each major claim with representative authors, roles, or short quote snippets; never with raw numeric HN IDs.
- Identify key people in the thread, such as the article author, library maintainer, founder, CEO, CTO, developer, employee, or other company/project insiders, and summarize their comments by subthread.
- Avoid treating reply count as a vote count; use it only as engagement/context.
- Avoid over-counting prolific authors as multiple independent votes.
- Separate substantive criticism from jokes, tangents, ideology, bikeshedding, and sarcasm.
- Call out notable disagreements, minority viewpoints, and uncertainty.
- Remember that HN commenters are a technical/startup-heavy audience and not representative of the general public.

## Output format

Keep the final answer concise and structured:

- Article summary
- Overall HN sentiment with confidence level
- Common opinion groups, with representative authors or short quote snippets
- Key people and their comments
- Notable caveats, minority views, and uncertainty

## Scripts

- [`scripts/prepare_hn_sentiment_analysis.py`](scripts/prepare_hn_sentiment_analysis.py) is the main pipeline. It downloads or loads a thread, writes raw Algolia JSON, and prepares bounded analysis artifacts.
- [`scripts/download_hn_thread.py`](scripts/download_hn_thread.py) only downloads the complete nested Algolia item JSON for a Hacker News thread URL or item id. Use it directly only when the user specifically asks for the raw JSON.
