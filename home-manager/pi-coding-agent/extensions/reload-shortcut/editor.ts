import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";

export function handleReloadShortcut(
  data: string,
  onSubmit?: (text: string) => void | Promise<void>,
): boolean {
  if (!matchesKey(data, "ctrl+r")) return false;
  void Promise.resolve(onSubmit?.("/reload"));
  return true;
}

export class ReloadShortcutEditor extends CustomEditor {
  handleInput(data: string): void {
    if (handleReloadShortcut(data, this.onSubmit)) return;
    super.handleInput(data);
  }
}
