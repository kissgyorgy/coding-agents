# pi-openai-usage

Shows your remaining OpenAI Codex subscription usage in Pi.

```text
Usage: 5h ████████░░ 88% | 7d ███████░░░ 73% | 5h ↺ 42m | 7d ↺ 2d4h
```

## Prerequisites

- [Pi](https://github.com/earendil-works/pi) CLI.
- An OpenAI subscription.

## Install

```bash
pi install npm:pi-openai-usage
```

## Login

This extension uses Pi's existing OpenAI Codex login. If you have not logged in yet, run:

```text
/login openai-codex
```

## Command

`/openai-usage-settings` is the command for OpenAI usage and settings.

Run it with no arguments in Pi's interactive UI to open the settings menu. In non-UI runs, it shows a read-only fallback with the available utility subcommands.

```text
/openai-usage-settings
/openai-usage-settings usage
/openai-usage-settings refresh
/openai-usage-settings diagnostics
/openai-usage-settings help
```

### Utility subcommands

Use utility subcommands when you want a direct status check, refresh, diagnostics, or help:

| Subcommand | What it does |
| --- | --- |
| `usage` | Show cached usage, refreshing first if the cache is missing or stale. |
| `refresh` | Force a usage refresh and show the updated usage status. |
| `diagnostics` | Show setup, auth, config-path, timestamp, and last-error diagnostics without printing tokens. |
| `help` | Show command help for the one-command workflow. |

Example form: `/openai-usage-settings usage`.

### Interactive settings menu

Running `/openai-usage-settings` with no arguments opens a ten-row menu for common settings:

| Row | Visible values |
| --- | --- |
| Display | `On`, `Off`, `Always` |
| Color scheme | `traffic`, `cyan`, `green`, `mono`, `none` |
| Bar style | `blocks`, `thin`, `ascii`, `dots`, `squares`, `braille` |
| Bar width | `4`, `6`, `8`, `10`, `12`, `16`, `20` |
| 5h display | `hidden`, `percent`, `bar`, `bar + percent` |
| 7d display | `hidden`, `percent`, `bar`, `bar + percent` |
| 5h reset display | `hidden`, `countdown`, `clock`, `both` |
| 7d reset display | `hidden`, `countdown`, `clock`, `both` |
| Refresh interval | `15s`, `30s`, `1m`, `2m`, `5m`, `10m` |
| Hide label | `No`, `Yes` |

`Display` controls whether the status line is shown normally, hidden, or always shown. Normal display appears for OAuth-backed `openai` and `openai-codex` models; `Always` shows usage regardless of the selected model. `Hide label` controls the `Usage:` prefix. If a JSON config uses a custom color scheme or custom bar style, the menu may show `custom (JSON)` as the current value; selecting a preset replaces it with that preset.

## Configuration files

Configuration is read from:

1. Project config: `.pi/extensions/pi-openai-usage.json`
2. Global config: `~/.pi/agent/extensions/pi-openai-usage.json`

Project config overrides global config.

The interactive menu writes to the project config only when `.pi/extensions/pi-openai-usage.json` already exists. Otherwise, menu changes are written to the global config. Create the project config file first if you want menu changes to stay project-local.

Use the interactive menu for common display settings. Advanced visual customization is JSON-file-only: edit the project or global config file for custom label text, widget labels, separators, partial bars, custom bar glyphs, custom color stops or targets, and bar-gradient controls. Slash-command setting writes are not supported.

## JSON configuration reference

### Top-level settings

| Key | Type | Default | Accepted values / notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enables or hides the status-line entry. |
| `refreshIntervalMs` | number | `60000` | `15000`, `30000`, `60000`, `120000`, `300000`, `600000`. |
| `display` | object | see below | Status-line label and visibility presentation. |
| `widgets` | object | see below | Usage and reset widgets. |
| `bar` | object | see below | Progress-bar style and width. |
| `colors` | object | see below | Color scheme, target, gradients, and custom stops. |

### `display`

| Key | Type | Default | Accepted values / notes |
| --- | --- | --- | --- |
| `display.showAlways` | boolean | `false` | `true` shows usage even when the selected model is not an OAuth-backed OpenAI/Codex model. |
| `display.showLabel` | boolean | `true` | Controls the label prefix. |
| `display.label` | string | `"Usage"` | Non-empty string. |
| `display.separator` | string | `" | "` | Separator between visible widgets. |

### `widgets`

| Key | Type | Default | Accepted values / notes |
| --- | --- | --- | --- |
| `widgets.fiveHour.enabled` | boolean | `true` | Shows or hides the 5h usage widget. |
| `widgets.fiveHour.label` | string | `"5h"` | Non-empty string. |
| `widgets.fiveHour.mode` | string | `"bar-percent"` | `percent`, `bar`, `bar-percent`, `hidden`. |
| `widgets.sevenDay.enabled` | boolean | `true` | Shows or hides the 7d usage widget. |
| `widgets.sevenDay.label` | string | `"7d"` | Non-empty string. |
| `widgets.sevenDay.mode` | string | `"bar-percent"` | `percent`, `bar`, `bar-percent`, `hidden`. |
| `widgets.fiveHourReset.enabled` | boolean | `true` | Shows or hides the 5h reset widget. |
| `widgets.fiveHourReset.label` | string | `"5h ↺"` | Non-empty string. |
| `widgets.fiveHourReset.mode` | string | `"countdown"` | `countdown`, `clock`, `both`, `hidden`. |
| `widgets.sevenDayReset.enabled` | boolean | `true` | Shows or hides the 7d reset widget. |
| `widgets.sevenDayReset.label` | string | `"7d ↺"` | Non-empty string. |
| `widgets.sevenDayReset.mode` | string | `"countdown"` | `countdown`, `clock`, `both`, `hidden`. |

### `bar`

| Key | Type | Default | Accepted values / notes |
| --- | --- | --- | --- |
| `bar.style` | string | `"blocks"` | `blocks`, `thin`, `ascii`, `dots`, `squares`, `braille`, `custom`. |
| `bar.width` | number | `10` | `4`, `6`, `8`, `10`, `12`, `16`, `20`. |
| `bar.partials` | boolean | `true` | Uses partial glyphs when the selected style supports them. |
| `bar.custom.filled` | string | `"▰"` | Filled glyph used when `bar.style` is `custom`. |
| `bar.custom.empty` | string | `"▱"` | Empty glyph used when `bar.style` is `custom`. |
| `bar.custom.partials` | string[] | `[]` | Optional partial glyphs used when `bar.style` is `custom` and `bar.partials` is `true`. |

### `colors`

| Key | Type | Default | Accepted values / notes |
| --- | --- | --- | --- |
| `colors.scheme` | string | `"traffic"` | `traffic`, `cyan`, `green`, `mono`, `none`, `custom`. |
| `colors.target` | string | `"value"` | `value`, `widget`, `bar`, `percent`, `none`. |
| `colors.barGradient.enabled` | boolean | `false` | Colors filled bar cells across the selected color scale. |
| `colors.barGradient.direction` | string | `"low-to-high"` | `low-to-high`, `high-to-low`. |
| `colors.custom.mode` | string | `"step"` | `step`, `gradient`. |
| `colors.custom.stops` | array | see below | Array of color stops sorted by `percent`. |

Default `colors.custom.stops` (matching the built-in traffic scheme):

| percent | color | label |
| --- | --- | --- |
| `80` | `#22c55e` | `green` |
| `60` | `#84cc16` | `lime` |
| `40` | `#eab308` | `yellow` |
| `20` | `#f97316` | `orange` |
| `0` | `#ef4444` | `red` |

Each custom color stop has this shape:

| Key | Type | Accepted values / notes |
| --- | --- | --- |
| `percent` | number | Clamped to `0` through `100`. |
| `color` | string or number | Pi theme token (`success`, `warning`, `error`, `muted`, `dim`, `text`, `accent`) for `step` mode, `#RRGGBB`, or xterm color number `0` through `255`. Gradient mode supports interpolating `#RRGGBB` and xterm colors. |
| `label` | string | Optional label for your own reference. |

## Display customization

The default display uses progress bars and percentages:

```text
Usage: 5h ████████░░ 88% | 7d ███████░░░ 73% | 5h ↺ 42m | 7d ↺ 2d4h
```

To simplify it in the interactive menu, set:

- Hide label: `Yes`
- 5h display: `percent`
- 7d display: `percent`
- 5h reset display: `hidden`
- 7d reset display: `hidden`

Result:

```text
5h: 88% | 7d: 73%
```

To use the neutral footer text colour instead of usage-coloured values, set Color scheme to `none`.

## Privacy and auth

The extension uses Pi's existing `openai-codex` OAuth credentials to request Codex usage from ChatGPT's usage endpoint. Diagnostics are designed for troubleshooting and do not print access tokens.

## Reference attribution

Inspired by [pi-better-openai](https://github.com/mattleong/pi-better-openai/).
