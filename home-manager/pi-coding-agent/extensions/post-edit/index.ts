import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createWriteTool } from "@mariozechner/pi-coding-agent";
import type { ExecFileException } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { formatContent } from "./format-file";

function isExecFileException(
  error: unknown,
): error is ExecFileException & { stderr?: unknown } {
  return (
    error instanceof Error &&
    ("code" in error || "stderr" in error || "stdout" in error)
  );
}

function getErrorMessage(error: unknown): string {
  if (
    isExecFileException(error) &&
    typeof error.stderr === "string" &&
    error.stderr.trim().length > 0
  ) {
    return error.stderr.trim();
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function (pi: ExtensionAPI) {
  // Format write tool_use arguments in the LLM context so the model sees
  // formatted code and continues in the same style.  Previously this was
  // done in a message_end handler, but spawning a formatter subprocess
  // there delays persistence of the assistant entry.  Because Agent.emit()
  // does not await async listeners, the next event's persistence can
  // finish first — corrupting the parentId chain in the session file.
  //
  // Doing it in context instead:
  //  - runs at a safe point (before the LLM call, not during persistence)
  //  - operates on a deep copy, so no mutation of stored messages
  //  - results are cached so formatters run at most once per unique content
  const formatCache = new Map<string, string>();

  pi.on("context", async (event) => {
    let modified = false;
    for (const msg of event.messages) {
      if (msg.role !== "assistant") continue;
      for (const block of (msg as any).content) {
        if (block.type !== "toolCall" || block.name !== "write") continue;
        const content: string | undefined = block.arguments?.content;
        let filePath: string = block.arguments?.path ?? "";
        if (filePath.startsWith("@")) filePath = filePath.slice(1);
        if (!content || !filePath) continue;

        const cacheKey = `${filePath}\0${content}`;
        let formatted: string;

        if (formatCache.has(cacheKey)) {
          formatted = formatCache.get(cacheKey)!;
        } else {
          try {
            const result = await formatContent(filePath, content);
            formatted = result.content;
          } catch {
            continue;
          }
          formatCache.set(cacheKey, formatted);
        }

        if (formatted !== content) {
          block.arguments.content = formatted;
          modified = true;
        }
      }
    }
    if (modified) return { messages: event.messages };
  });

  // Override the built-in write tool to format content before writing.
  const builtinWrite = createWriteTool(process.cwd());

  pi.registerTool({
    ...builtinWrite,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const result = await formatContent(params.path, params.content);
        if (result.changed) params.content = result.content;
      } catch (error: unknown) {
        ctx.ui.notify(
          `post-edit: formatting ${params.path} failed: ${getErrorMessage(error)}`,
          "error",
        );
      }

      return builtinWrite.execute(toolCallId, params, signal, onUpdate);
    },
  });

  // For edit, format the file after it has been written.
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit") return;
    if (event.isError) return;

    let filePath: string = (event.input as any).path ?? "";
    if (filePath.startsWith("@")) filePath = filePath.slice(1);

    try {
      const content = readFileSync(filePath, "utf8");
      const result = await formatContent(filePath, content);
      if (!result.changed) return;

      writeFileSync(filePath, result.content, "utf8");
      return {
        content: [
          {
            type: "text",
            text:
              `Successfully replaced text in ${filePath}.\n` +
              `Note: the diff was generated BEFORE auto-formatting was applied to the file.`,
          },
        ],
      };
    } catch (error: unknown) {
      ctx.ui.notify(
        `post-edit: formatting ${filePath} failed: ${getErrorMessage(error)}`,
        "error",
      );
    }
  });
}
