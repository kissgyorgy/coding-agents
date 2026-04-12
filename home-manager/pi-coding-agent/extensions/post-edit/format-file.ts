import { execFile } from "node:child_process";

export interface FormatResult {
  changed: boolean;
  content: string;
}

function getFirstLine(content: string): string {
  const newline = content.indexOf("\n");
  return newline === -1 ? content : content.slice(0, newline);
}

const PYTHON_SHEBANG_PATTERN = /^#!.*\bpython(?:\d+(?:\.\d+)*)?\b/;

function isPythonFile(filePath: string, content: string): boolean {
  return (
    filePath.endsWith(".py") ||
    PYTHON_SHEBANG_PATTERN.test(getFirstLine(content))
  );
}

const PRETTIER_EXTENSIONS = new Set([
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
]);

const JINJA2_PATTERN = /\{[%#{][\s\S]*?[%#}]\}/;

function isJinja2Template(content: string): boolean {
  return JINJA2_PATTERN.test(content);
}

function isPrettierFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  return dot !== -1 && PRETTIER_EXTENSIONS.has(filePath.slice(dot));
}

function isGoFile(filePath: string): boolean {
  return filePath.endsWith(".go");
}

const SHFMT_SHEBANG_PATTERN = /^#!.*\b(?:sh|bash|dash|ash|ksh|mksh)\b/;

function isShellScript(filePath: string, content: string): boolean {
  return (
    filePath.endsWith(".sh") ||
    SHFMT_SHEBANG_PATTERN.test(getFirstLine(content))
  );
}

function isNixFile(filePath: string): boolean {
  return filePath.endsWith(".nix");
}

interface Formatter {
  check: (filePath: string, content: string) => boolean;
  cmd: string;
  args: (filePath: string) => string[];
}

const FORMATTERS = new Map<string, Formatter>([
  [
    "Python",
    {
      check: isPythonFile,
      cmd: "ruff",
      args: (p) => ["format", "--stdin-filename", p, "-"],
    },
  ],
  [
    "Prettier",
    {
      check: (p, _content) => isPrettierFile(p),
      cmd: "prettier",
      args: (p) => ["--stdin-filepath", p],
    },
  ],
  [
    "Shell",
    {
      check: isShellScript,
      cmd: "shfmt",
      args: (_p) => [],
    },
  ],
  [
    "Nix",
    {
      check: (p, _content) => isNixFile(p),
      cmd: "nixpkgs-fmt",
      args: (_p) => [],
    },
  ],
  [
    "Go",
    {
      check: (p, _content) => isGoFile(p),
      cmd: "gofmt",
      args: (_p) => [],
    },
  ],
]);

function selectFormatter(
  filePath: string,
  content: string,
): [string, Formatter] | undefined {
  for (const entry of FORMATTERS.entries()) {
    if (entry[1].check(filePath, content)) return entry;
  }
  return undefined;
}

function runFormatterOnString(
  cmd: string,
  args: string[],
  input: string,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { encoding: "utf8", timeout: timeoutMs },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
    child.stdin!.write(input);
    child.stdin!.end();
  });
}

export async function formatContent(
  filePath: string,
  content: string,
): Promise<FormatResult> {
  const selected = selectFormatter(filePath, content);
  if (!selected) return { changed: false, content };

  // Skip Prettier for HTML files containing Jinja2 syntax
  if (filePath.endsWith(".html") && isJinja2Template(content)) {
    return { changed: false, content };
  }

  const [, formatter] = selected;
  const formatted = await runFormatterOnString(
    formatter.cmd,
    formatter.args(filePath),
    content,
  );
  return { changed: formatted !== content, content: formatted };
}
