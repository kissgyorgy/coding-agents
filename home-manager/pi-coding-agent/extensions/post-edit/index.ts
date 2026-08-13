import {
  generateUnifiedPatch,
  isToolCallEventType,
  truncateHead,
  withFileMutationQueue,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { ExecFileException } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { formatContent, type FormatResult } from "./format-file";

interface FormatResultRecord {
  filePath: string;
  changed: boolean;
  patch?: string;
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
    return {
      filePath,
      changed: true,
      patch: generateUnifiedPatch(filePath, content, result.content),
    };
  } catch (error: unknown) {
    return { filePath, changed: false, error: getErrorMessage(error) };
  }
}

function formatCacheKey(filePath: string, content: string): string {
  return `${filePath}\0${content}`;
}

export default function (pi: ExtensionAPI) {
  const formatCache = new Map<string, Promise<FormatResult>>();
  const preformattedWrites = new Map<string, string>();

  function formatCached(
    filePath: string,
    content: string,
  ): Promise<FormatResult> {
    const key = formatCacheKey(filePath, content);
    const cached = formatCache.get(key);
    if (cached) return cached;

    const result = formatContent(filePath, content);
    formatCache.set(key, result);
    return result;
  }

  pi.on("turn_start", () => {
    formatCache.clear();
    preformattedWrites.clear();
  });

  // Persist formatted write arguments in the assistant message. Without this,
  // later edits are based on the model's unformatted write even though the file
  // on disk has already been changed by the formatter.
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    let changed = false;
    const content = await Promise.all(
      event.message.content.map(async (block) => {
        if (block.type !== "toolCall" || block.name !== "write") return block;
        if (typeof block.arguments.content !== "string") return block;

        const filePath = normalizeToolPath(block.arguments.path, ctx.cwd);
        if (!filePath) return block;

        try {
          const result = await formatCached(filePath, block.arguments.content);
          if (!result.changed) return block;

          changed = true;
          preformattedWrites.set(block.id, result.content);
          return {
            ...block,
            arguments: { ...block.arguments, content: result.content },
          };
        } catch {
          // The post-execution pass reports formatter failures in the tool
          // result, where both the model and the user can see them.
          return block;
        }
      }),
    );

    if (changed) return { message: { ...event.message, content } };
  });

  // message_end changes persisted history, while tool_call is the documented
  // place to change the arguments used by the actual tool execution. Apply the
  // same result in both places so history and disk stay identical.
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("write", event)) return;

    const historyContent = preformattedWrites.get(event.toolCallId);
    if (historyContent !== undefined) {
      event.input.content = historyContent;
      return;
    }

    const filePath = normalizeToolPath(event.input.path, ctx.cwd);
    if (!filePath) return;

    try {
      const result = await formatCached(filePath, event.input.content);
      if (!result.changed) return;

      event.input.content = result.content;
      preformattedWrites.set(event.toolCallId, result.content);
    } catch {
      // Let write proceed. The tool_result handler retries formatting and adds
      // any failure to the persisted result instead of blocking the write.
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;

    const wasPreformatted =
      event.toolName === "write" && preformattedWrites.delete(event.toolCallId);
    if (event.isError) return;

    const filePath = normalizeToolPath(event.input.path, ctx.cwd);
    if (!filePath) return;

    // Built-in edit and write calls use this same queue. Formatting here keeps
    // the read-format-write window ordered with parallel mutations of the file
    // and finishes before the tool result is persisted or sent to the model.
    const result = await withFileMutationQueue(filePath, () =>
      formatFile(filePath),
    );
    const displayPath = describePath(filePath, ctx.cwd);

    if ((result.changed || wasPreformatted) && ctx.hasUI) {
      ctx.ui.notify(`post-edit: formatted ${displayPath}`, "info");
    }

    if (result.error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `post-edit: formatting ${displayPath} failed: ${result.error}`,
          "warning",
        );
      }

      return {
        content: [
          ...event.content,
          {
            type: "text" as const,
            text: `Auto-formatting ${displayPath} failed: ${result.error}`,
          },
        ],
      };
    }

    if (!result.changed || !result.patch) return;

    const patch = truncateHead(result.patch);
    const truncationNote = patch.truncated
      ? `\n[Formatting patch truncated; read ${displayPath} for its complete current content.]`
      : "";

    return {
      content: [
        ...event.content,
        {
          type: "text" as const,
          text:
            `Auto-formatting changed ${displayPath} after this tool. ` +
            `The file's current content includes this additional patch:\n${patch.content}${truncationNote}`,
        },
      ],
    };
  });

  pi.on("turn_end", () => {
    formatCache.clear();
    preformattedWrites.clear();
  });
}
