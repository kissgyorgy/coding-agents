import {
  isToolCallEventType,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import {
  matchingFileRule,
  matchingRule,
  type BashBlacklistFileMatch,
} from "./file-matching.js";
import { config, type BashBlacklistRule } from "./rules.js";

function formatBlockMessage(
  blockedCommand: string,
  rule: BashBlacklistRule,
): string {
  return [
    config.messagePrefix,
    `Rule: ${rule.name}`,
    `Blocked command:\n${blockedCommand}`,
    rule.message,
  ].join("\n\n");
}

function formatFileBlockMessage(match: BashBlacklistFileMatch): string {
  return [
    config.messagePrefix,
    `Rule: ${match.rule.name}`,
    `The file ${match.path} contains this blocked command at line ${match.line}:\n${match.command}`,
    "Either modify the file if you wrote it or use something else.",
    match.rule.message,
  ].join("\n\n");
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;

    const match = matchingRule(event.input.command);
    if (match) {
      return {
        block: true,
        reason: formatBlockMessage(match.command, match.rule),
      };
    }

    const fileMatch = matchingFileRule(event.input.command, ctx.cwd);
    if (!fileMatch) return undefined;

    return {
      block: true,
      reason: formatFileBlockMessage(fileMatch),
    };
  });
}
