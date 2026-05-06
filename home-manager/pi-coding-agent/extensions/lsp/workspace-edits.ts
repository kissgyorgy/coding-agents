import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { invalidateFilePreviewCache } from "./formatters";
import type { LspClient } from "./lsp-client";
import type { Position, TextEdit, WorkspaceEdit } from "./types";

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function getLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === "\r") {
      if (content[i + 1] === "\n") i++;
      offsets.push(i + 1);
    } else if (char === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function getLineContentEnd(
  content: string,
  lineOffsets: number[],
  line: number,
): number {
  let end =
    line + 1 < lineOffsets.length ? lineOffsets[line + 1] : content.length;
  if (end > 0 && content[end - 1] === "\n") end--;
  if (end > 0 && content[end - 1] === "\r") end--;
  return end;
}

function positionToOffset(
  content: string,
  lineOffsets: number[],
  pos: Position,
): number {
  if (pos.line < 0 || pos.line >= lineOffsets.length) {
    throw new Error(
      `Invalid edit position ${pos.line + 1}:${pos.character + 1}`,
    );
  }

  const lineStart = lineOffsets[pos.line];
  const lineEnd = getLineContentEnd(content, lineOffsets, pos.line);
  const clampedCharacter = Math.min(
    pos.character,
    Math.max(0, lineEnd - lineStart),
  );
  return lineStart + clampedCharacter;
}

export function applyTextEdits(
  content: string,
  edits: TextEdit[],
  path: string,
): string {
  const lineOffsets = getLineOffsets(content);
  const normalized = edits.map((edit, index) => {
    const start = positionToOffset(content, lineOffsets, edit.range.start);
    const end = positionToOffset(content, lineOffsets, edit.range.end);
    if (end < start) {
      throw new Error(
        `Invalid edit range in ${path} at ${edit.range.start.line + 1}:${edit.range.start.character + 1}`,
      );
    }
    return { ...edit, start, end, index };
  });

  normalized.sort(
    (a, b) => a.start - b.start || a.end - b.end || a.index - b.index,
  );
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i].start < normalized[i - 1].end) {
      throw new Error(`Overlapping rename edits in ${path}`);
    }
  }

  normalized.sort(
    (a, b) => b.start - a.start || b.end - a.end || b.index - a.index,
  );

  let updated = content;
  for (const edit of normalized) {
    updated =
      updated.slice(0, edit.start) + edit.newText + updated.slice(edit.end);
  }
  return updated;
}

export function collectWorkspaceEditChanges(
  edit: WorkspaceEdit,
): Map<string, TextEdit[]> {
  const files = new Map<string, TextEdit[]>();

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      files.set(uriToPath(uri), [...edits]);
    }
  }

  for (const change of edit.documentChanges ?? []) {
    if (!("edits" in change)) {
      throw new Error(`Unsupported workspace edit operation: ${change.kind}`);
    }
    const path = uriToPath(change.textDocument.uri);
    const existing = files.get(path) ?? [];
    existing.push(...change.edits);
    files.set(path, existing);
  }

  return files;
}

async function withFileMutationQueues<T>(
  paths: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const uniquePaths = [...new Set(paths)].sort();

  const run = async (index: number): Promise<T> => {
    if (index >= uniquePaths.length) return fn();
    return withFileMutationQueue(uniquePaths[index], () => run(index + 1));
  };

  return run(0);
}

export async function applyWorkspaceEdit(
  edit: WorkspaceEdit,
  client: LspClient,
): Promise<void> {
  const fileEdits = collectWorkspaceEditChanges(edit);
  const paths = [...fileEdits.keys()];
  if (paths.length === 0) return;

  await withFileMutationQueues(paths, async () => {
    const nextContents = new Map<string, string>();

    for (const path of paths) {
      const content = readFileSync(path, "utf8");
      const next = applyTextEdits(content, fileEdits.get(path) ?? [], path);
      nextContents.set(path, next);
    }

    for (const path of paths) {
      writeFileSync(path, nextContents.get(path) ?? "", "utf8");
      invalidateFilePreviewCache(path);
    }

    for (const path of paths) {
      await client.refreshDocument(path);
    }
  });
}
