import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
  // Intercept write tool calls before the assistant message is stored to disk.
  // Extensions run before storage, and message is passed by reference — mutations persist.
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    for (const block of (event.message as any).content) {
      if (block.type !== "toolCall" || block.name !== "write") continue;

      let filePath: string = block.arguments.path ?? "";
      if (filePath.startsWith("@")) filePath = filePath.slice(1);

      try {
        const result = await formatContent(filePath, block.arguments.content);
        if (result.changed) block.arguments.content = result.content;
      } catch (error: unknown) {
        ctx.ui.notify(
          `post-edit: formatting ${filePath} failed: ${getErrorMessage(error)}`,
          "error",
        );
      }
    }
  });

  // For edit, format the file after it has been written and return the result.
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
        content: [{ type: "text", text: `Formatted: ${filePath}` }],
      };
    } catch (error: unknown) {
      ctx.ui.notify(
        `post-edit: formatting ${filePath} failed: ${getErrorMessage(error)}`,
        "error",
      );
    }
  });
}
