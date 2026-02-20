import * as fs from "node:fs";
import { execFile } from "node:child_process";

export interface FormatResult {
  changed: boolean;
  content: string;
}

function isPythonFile(filePath: string): boolean {
  return filePath.endsWith(".py");
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

function isPrettierFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  return dot !== -1 && PRETTIER_EXTENSIONS.has(filePath.slice(dot));
}

function isGoFile(filePath: string): boolean {
  return filePath.endsWith(".go");
}

function isShellScript(filePath: string): boolean {
  if (filePath.endsWith(".sh")) return true;
  try {
    const firstLine = fs.readFileSync(filePath, "utf8").split("\n")[0] ?? "";
    return firstLine.startsWith("#!/usr/bin/env");
  } catch {
    return false;
  }
}

function isNixFile(filePath: string): boolean {
  return filePath.endsWith(".nix");
}

interface Formatter {
  check: (filePath: string) => boolean;
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
      check: isPrettierFile,
      cmd: "prettier",
      args: (p) => ["--stdin-filepath", p],
    },
  ],
  ["Shell", { check: isShellScript, cmd: "shfmt", args: (_) => [] }],
  ["Nix", { check: isNixFile, cmd: "nixpkgs-fmt", args: (_) => [] }],
  ["Go", { check: isGoFile, cmd: "gofmt", args: (_) => [] }],
]);

function selectFormatter(filePath: string): [string, Formatter] | undefined {
  for (const entry of FORMATTERS.entries()) {
    if (entry[1].check(filePath)) return entry;
  }
  return undefined;
}

function runFormatterOnString(
  cmd: string,
  args: string[],
  input: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
    child.stdin!.write(input);
    child.stdin!.end();
  });
}

export async function formatContent(
  filePath: string,
  content: string,
): Promise<FormatResult> {
  const selected = selectFormatter(filePath);
  if (!selected) return { changed: false, content };

  const [, formatter] = selected;
  const formatted = await runFormatterOnString(
    formatter.cmd,
    formatter.args(filePath),
    content,
  );
  return { changed: formatted !== content, content: formatted };
}
