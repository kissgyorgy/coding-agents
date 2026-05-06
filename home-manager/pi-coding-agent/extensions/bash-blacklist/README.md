# bash-blacklist

Blocks Pi agent bash tool calls when the raw command matches a configured
regular-expression rule. User `!` bash commands are not intercepted.

Configure rules in `rules.ts`. Rules use native TypeScript/JavaScript `RegExp` literals:

```ts
{
  name: "example",
  regex: /(?:^|[;&|\n])\s*(dangerous-command[^;&|\n]*)/,
  message: "Tell the LLM and user what to do instead.",
}
```

The extension displays the first capture group (`match[1]`) as the blocked
command, falling back to the full match when there is no capture group. Put the
relevant command segment in that first group.

If an agent bash command contains a token that looks like an existing file path,
`file-matching.ts` reads that file and applies the same rules to its contents.
If a rule matches inside a file, the denial points to the file and line number
and asks the agent to modify the file or use something else.

File-content scanning is skipped for command segments whose command name is in
`config.fileContentCommandWhitelist`. That whitelist is for commands that take
file paths as data and do not run the file, such as `wc`, `cat`, `ls`, `stat`,
`grep`, `rg`, `diff`, `cp`, `mv`, `chmod`, `chown`, archive tools, checksums,
and editors. Commands that can execute or interpret the file (`bash`, `sh`,
`python`, `node`, `xargs`, `awk`, `sed`, `jq`, etc.) are intentionally not in
the whitelist.

`messagePrefix` customizes the denial header. Blocked bash tool calls return the
denial as the tool result.
