import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { config, type BashBlacklistRule } from "./rules.js";

export interface BashBlacklistMatch {
  rule: BashBlacklistRule;
  command: string;
  index: number;
}

export interface BashBlacklistFileMatch extends BashBlacklistMatch {
  path: string;
  line: number;
}

export function matchingRule(command: string): BashBlacklistMatch | undefined {
  for (const rule of config.rules) {
    const match = command.match(rule.regex);

    if (match) {
      const matchedText = match[1] ?? match[0];
      const blockedCommand = matchedText.trim();
      const matchIndex = match.index ?? command.indexOf(match[0]);
      const groupIndex = match[1] ? match[0].indexOf(match[1]) : 0;
      const trimOffset = matchedText.length - matchedText.trimStart().length;

      return {
        rule,
        command: blockedCommand || command,
        index: Math.max(0, matchIndex + Math.max(0, groupIndex) + trimOffset),
      };
    }
  }

  return undefined;
}

function commandSegments(command: string): string[] {
  return command
    .split(/[;&|\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function commandTokens(command: string): string[] {
  return (
    command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|()<>]+/g)?.map((token) => {
      if (token.startsWith('"') && token.endsWith('"')) {
        return token.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
      }
      if (token.startsWith("'") && token.endsWith("'")) {
        return token.slice(1, -1);
      }
      return token.replace(/\\(.)/g, "$1");
    }) ?? []
  );
}

function isAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function commandName(tokens: string[]): string | undefined {
  const token = tokens.find((token) => !isAssignment(token));
  if (!token) return undefined;

  const parts = token.split("/").filter((part) => part.length > 0);
  return parts.at(-1) ?? token;
}

function looksLikePath(token: string): boolean {
  if (!token || token.includes("\0") || token.includes("://")) return false;
  if (token.startsWith("-") || /[$*?[\]{}]/.test(token)) return false;

  return (
    token.startsWith("/") ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("~/") ||
    token.includes("/") ||
    /\.[A-Za-z0-9][A-Za-z0-9_-]*$/.test(token)
  );
}

function resolvePath(token: string, cwd: string): string | undefined {
  if (!looksLikePath(token)) return undefined;
  if (token.startsWith("~/")) return resolve(homedir(), token.slice(2));
  return resolve(cwd, token);
}

function readExistingFile(path: string): string | undefined {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function matchingFileRule(
  command: string,
  cwd: string,
): BashBlacklistFileMatch | undefined {
  const seen = new Set<string>();

  for (const segment of commandSegments(command)) {
    const tokens = commandTokens(segment);
    const command = commandName(tokens);
    if (command && config.fileContentWhitelist.has(command)) continue;

    for (const token of tokens) {
      const path = resolvePath(token, cwd);
      if (!path || seen.has(path)) continue;
      seen.add(path);

      const content = readExistingFile(path);
      if (content === undefined) continue;

      const match = matchingRule(content);
      if (!match) continue;

      return {
        ...match,
        path: token,
        line: lineNumberAt(content, match.index),
      };
    }
  }

  return undefined;
}
