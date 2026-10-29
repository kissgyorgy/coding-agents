import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showMarkdownViewModal } from "../lib/markdown-viewer.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("inspect:systemprompt", {
    description: "Show the current system prompt verbatim",
    handler: async (_args, ctx) => {
      const prompt = ctx.getSystemPrompt();
      if (prompt) {
        await showMarkdownViewModal(ctx, "System prompt", prompt);
      } else {
        ctx.ui.notify("No system prompt loaded.", "warning");
      }
    },
  });
}
