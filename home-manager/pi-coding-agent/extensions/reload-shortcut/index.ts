import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ReloadShortcutEditor } from "./editor.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorComponent(
      (tui, theme, kb) => new ReloadShortcutEditor(tui, theme, kb),
    );
  });
}
