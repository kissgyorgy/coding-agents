This extension registers `anthropic-omp`, displayed as **Anthropic (OMP-style)**.
It does not replace Pi's `anthropic` provider, read Claude Code credentials, or
launch Claude Code. It requires Pi 1.4's native provider and fetch-injection APIs.

Run `/reload`, then `/login anthropic-omp`. Pi's built-in Anthropic OAuth flow
handles browser/copy-code login, storage in `auth.json`, refresh locking, and
logout. Credentials are saved under `anthropic-omp`, independently of
`anthropic`. Choose a model from Anthropic (OMP-style) in `/model` afterward.
Use `/logout` to remove only this provider's credentials.

`/anthropic-usage` displays the account's five-hour and weekly subscription
utilization, available per-model weekly limits, reset times, and reported USD
extra-usage spending. Endpoint results are cached for one minute; failures and
HTTP 429 responses back off, respecting Retry-After. Inference response headers
update a compact status indicator without polling. Missing counters are not
shown as zero, and failed refreshes retain the last report with its original
timestamp. The command uses the extension's login even when another provider
is selected. It does not alter account spending settings or buy reset credits.

The request adapter reuses Pi's model catalog, message conversion, reasoning,
streaming, retries, tool handling, cancellation, and instrumentation. It adds
OMP-style CLI headers, stable account/install/session metadata, a billing system
block with a checksum of the final serialized UTF-8 body, and wire-only custom
tool prefixes. Streamed tool names are restored before Pi interprets them.
Only HTTPS requests to `api.anthropic.com/v1/messages` are allowed; redirects,
proxy endpoint overrides, and injected SDK clients are rejected. Custom fetch
implementations remain trusted code. Existing Pi request hooks still execute;
the wire adapter runs after payload hooks so their final output is attested.

The adapter also rewords Pi 1.4's recognized, stock `<docs>` system section.
It retains the documentation paths, guide topics, and complete-reading policy;
the coding preamble, project instructions, skills, user messages, and tool
inputs are not rewritten. The same adaptation applies to native mid-conversation
system updates, and the checksum is calculated afterward. Custom or modified
documentation sections are left alone. These changes are wire-only and confined
to this provider, so no re-login or global Pi prompt change is required.

Live A/B checks on 2026-10-31 reproduced the extra-usage HTTP 400 with Pi's
stock documentation wording, while identity-only, generic, and short coding
prompts succeeded. The stock coding preamble alone succeeded too. Keeping the
full project instructions and a tool declaration but rewording only the generated
documentation section succeeded with Sonnet 4.6 and Opus 4.8. Extra usage was
disabled throughout, and the usage endpoint continued to report $0.00 extra
spending. This is evidence for these requests, not a permanent billing guarantee
or proof of Anthropic's internal classification rules.

Compatibility details are adapted from
[oh-my-pi commit 35c5fc5f9a](https://github.com/can1357/oh-my-pi/tree/35c5fc5f9a),
particularly `packages/ai/src/providers/anthropic.ts`, `anthropic-identity.ts`,
`anthropic-headers.ts`, `claude-code-fingerprint.ts`, and `usage/claude.ts`.
The upstream MIT license is retained in `LICENSE`. No OMP runtime or new npm
dependencies are required. Claude Code version 2.1.280 and its SDK fingerprint
are pinned to that source. `PI_AI_CLAUDE_CODE_VERSION` can override the CLI
version with a `major.minor.patch` value when compatibility needs updating.

This is an experimental third-party integration, not an officially supported
subscription client. Matching OMP's request format does **not** establish
permission to use included subscription quota or guarantee how Anthropic bills
a request. Displayed account counters are not per-request billing receipts.
Compare subscription utilization and extra-usage spending in
[Claude settings](https://claude.ai/settings/usage) before and after a small
controlled session. Disable extra usage there if you do not want overage
charges. The extension does not enforce a zero-spend guarantee. API policy,
entitlements, and compatibility can change server-side.

This is a single-account integration. It does not port OMP's account rotation,
slow-lane state machine, reset-credit redemption, or native compaction. Those
features are separate from login and request compatibility.

Run the offline tests from the coding-agents directory:

```sh
node --experimental-vm-modules --test home-manager/pi-coding-agent/anthropic-omp.test.mjs
```

Set `PI_PACKAGE_DIR` to the installed `@earendil-works/pi-coding-agent` directory
to also exercise Pi's actual extension loader, credential store, and streaming
implementation against mocked fetch responses. These tests never authorize an
account or make live Anthropic requests.
