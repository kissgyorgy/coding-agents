import { matchesKey } from "@earendil-works/pi-tui";

export const CONTINUE_COMMAND = "/continue";
export const CONTINUE_SHORTCUT = "alt+r";

export function handleContinueShortcut(
  data: string,
  onSubmit?: (text: string) => void | Promise<void>,
): boolean {
  if (!matchesKey(data, CONTINUE_SHORTCUT)) return false;
  void Promise.resolve(onSubmit?.(CONTINUE_COMMAND));
  return true;
}
