import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("systemprompt", {
    description: "Show the current system prompt verbatim",
    handler: async (_args, ctx) => {
      const prompt = ctx.getSystemPrompt();
      if (prompt) {
        pi.sendMessage({
          customType: "systemprompt",
          content: prompt,
          display: true,
        });
      } else {
        ctx.ui.notify("No system prompt loaded.", "warning");
      }
    },
  });
}
