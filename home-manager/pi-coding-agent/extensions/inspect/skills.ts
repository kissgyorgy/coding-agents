import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showMarkdownViewModal } from "../lib/markdown-viewer.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("inspect:skills", {
    description: "List available skills and their descriptions",
    handler: async (_args, ctx) => {
      const skills = pi
        .getCommands()
        .filter((command) => command.source === "skill")
        .sort((a, b) => a.name.localeCompare(b.name));
      const lines = skills.map((skill) => {
        const description = skill.description?.replace(/\n/g, "\n  ");
        return `- \`/${skill.name}\`${description ? `\n  ${description}` : ""}`;
      });

      await showMarkdownViewModal(
        ctx,
        `Skills (${skills.length})`,
        lines.length ? lines.join("\n") : "No skills available.",
      );
    },
  });
}
