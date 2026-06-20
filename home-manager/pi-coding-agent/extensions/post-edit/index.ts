import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ExecFileException } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { formatContent } from "./format-file";

interface FormatResultRecord {
  filePath: string;
  changed: boolean;
  error?: string;
}

function isExecFileException(
  error: unknown,
): error is ExecFileException & { stderr?: unknown } {
  return (
    error instanceof Error &&
    ("code" in error || "stderr" in error || "stdout" in error)
  );
}

function getErrorText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : undefined;
  }

  if (value instanceof Uint8Array) {
    const text = Buffer.from(value).toString("utf8").trim();
    return text.length > 0 ? text : undefined;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (isExecFileException(error)) {
    const stderr = getErrorText(error.stderr);
    if (stderr) return stderr;

    const stdout = getErrorText(error.stdout);
    if (stdout) return stdout;
  }

  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeToolPath(rawPath: unknown, cwd: string): string | undefined {
  if (typeof rawPath !== "string") return undefined;
  const withoutPrefix = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  const trimmed = withoutPrefix.trim();
  if (!trimmed) return undefined;
  return resolve(cwd, trimmed);
}

function describePath(filePath: string, cwd: string): string {
  const short = relative(cwd, filePath);
  return short.startsWith("..") ? filePath : short;
}

async function formatFile(filePath: string): Promise<FormatResultRecord> {
  try {
    const content = await readFile(filePath, "utf8");
    const result = await formatContent(filePath, content);

    if (!result.changed) {
      return { filePath, changed: false };
    }

    await writeFile(filePath, result.content, "utf8");
    return { filePath, changed: true };
  } catch (error: unknown) {
    return { filePath, changed: false, error: getErrorMessage(error) };
  }
}

function notifyAgent(
  changedFiles: FormatResultRecord[],
  failedFiles: FormatResultRecord[],
  ctx: ExtensionContext,
  pi: ExtensionAPI,
) {
  const messageLines: string[] = [];
  const cwd = ctx.cwd;

  if (changedFiles.length > 0) {
    messageLines.push("I reformatted these files after this turn:");
    for (const item of changedFiles) {
      messageLines.push(`- ${describePath(item.filePath, cwd)}`);
    }
  }

  if (failedFiles.length > 0) {
    messageLines.push("Formatting failed for:");
    for (const item of failedFiles) {
      const reason = item.error ? ` (${item.error})` : "";
      messageLines.push(`- ${describePath(item.filePath, cwd)}${reason}`);
    }
  }
}

function scheduleEndOfTurnFormatting(
  paths: string[],
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): void {
  if (paths.length === 0) return;

  const uniquePaths = [...new Set(paths)];

  void (async () => {
    const results = await Promise.all(
      uniquePaths.map((filePath) => formatFile(filePath)),
    );

    const changedFiles = results.filter((result) => result.changed);
    const failedFiles = results.filter((result) => result.error);

    if (changedFiles.length === 0 && failedFiles.length === 0) return;

    if (changedFiles.length > 0 && ctx.hasUI) {
      const pathsText = changedFiles
        .map((entry) => describePath(entry.filePath, ctx.cwd))
        .join(", ");
      ctx.ui.notify(
        `post-edit: formatted ${changedFiles.length} file(s): ${pathsText}`,
        "info",
      );
    }

    for (const result of failedFiles) {
      if (!ctx.hasUI) continue;
      ctx.ui.notify(
        `post-edit: formatting ${describePath(result.filePath, ctx.cwd)} failed: ${result.error}`,
        "warning",
      );
    }

    notifyAgent(changedFiles, failedFiles, ctx, pi);
  })();
}

export default function (pi: ExtensionAPI) {
  const formattedCandidates = new Set<string>();

  pi.on("turn_start", () => {
    formattedCandidates.clear();
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) return;
    if (event.toolName !== "edit" && event.toolName !== "write") return;

    const filePath = normalizeToolPath(
      (event.input as { path?: unknown } | undefined)?.path,
      ctx.cwd,
    );
    if (!filePath) return;

    formattedCandidates.add(filePath);
  });

  pi.on("turn_end", (_event, ctx) => {
    const paths = Array.from(formattedCandidates);
    formattedCandidates.clear();
    scheduleEndOfTurnFormatting(paths, ctx, pi);
  });
}
