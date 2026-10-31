// Match only Pi 1.4's generated documentation section, never arbitrary custom docs.
const PI_DOCS =
  /<docs>\r?\nPi documentation \(read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI\):\r?\n([\s\S]*?)\r?\n<\/docs>/g;

const PI_DOCS_POLICY = `- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

export function rewritePiDocumentation(text: string): string {
  return text.replace(PI_DOCS, (original, body: string) => {
    const lines = body.split(/\r?\n/);
    if (lines.length !== 7 || lines.slice(3).join("\n") !== PI_DOCS_POLICY) {
      return original;
    }
    const readme = /^- Main documentation: (.+)$/m.exec(body)?.[1]?.trim();
    const docs = /^- Additional docs: (.+)$/m.exec(body)?.[1]?.trim();
    const examples = /^- Examples: (.+)$/m.exec(body)?.[1]?.trim();
    if (!readme || !docs || !examples) return original;

    // Live A/B tests found the stock docs wording triggered the extra-usage error.
    // Keep the reference paths and reading policy instead of dropping the section.
    return `<docs>
For Pi-specific questions, consult the installed references before implementing changes.
Overview: ${readme}
Guide directory: ${docs}
Example directory: ${examples}
Resolve guide links under the guide directory and example links under the example directory, not the current project. Read relevant Markdown files completely and follow their cross-references. Consult corresponding examples.
Guides: extensions.md, themes.md, skills.md, prompt-templates.md, tui.md, keybindings.md, sdk.md, custom-provider.md, models.md, packages.md, environment-variables.md, mcp.md, codemode.md. Codemode covers script execution and non-LLM models. TUI details are in tui.md.
</docs>`;
  });
}
