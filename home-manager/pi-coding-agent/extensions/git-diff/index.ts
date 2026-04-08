import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import type { OverlayHandle, TUI } from "@mariozechner/pi-tui";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { handleReloadShortcut } from "../reload-shortcut/editor.js";
import { parseDiff, type DiffFile } from "./parser.js";

const PANEL_FRACTION = 0.4;
const PANEL_MIN_WIDTH = 45;
const CHROME_LINES = 6;
const FOOTER_ROWS = 2;
const FOLD_PREVIEW = 5;
const SCROLL_STEP = 3;

function panelCols(termW: number): number {
  return Math.max(PANEL_MIN_WIDTH, Math.floor(termW * PANEL_FRACTION));
}

export default function (pi: ExtensionAPI) {
  let overlayHandle: OverlayHandle | null = null;
  let diffPanel: DiffPanel | null = null;
  let panelVisible = false;
  let tuiRef: TUI | null = null;
  let themeRef: Theme | null = null;
  let termH = 40;
  let savedCtx: ExtensionContext | null = null;

  async function getCommitDiff(): Promise<string> {
    // 1. Commits not yet pushed to upstream tracking branch
    const upstream = await pi.exec("git", [
      "log",
      "-p",
      "--format=",
      "@{upstream}..HEAD",
    ]);
    if (upstream.code === 0 && upstream.stdout.trim()) return upstream.stdout;

    // 2. Commits diverging from main / master via merge-base
    for (const base of ["main", "master"]) {
      const verify = await pi.exec("git", ["rev-parse", "--verify", base]);
      if (verify.code !== 0) continue;
      const mb = await pi.exec("git", ["merge-base", "HEAD", base]);
      if (mb.code !== 0 || !mb.stdout.trim()) continue;
      const diff = await pi.exec("git", [
        "log",
        "-p",
        "--format=",
        `${mb.stdout.trim()}..HEAD`,
      ]);
      if (diff.code === 0 && diff.stdout.trim()) return diff.stdout;
    }

    // 3. Fall back to last 10 commits
    const last = await pi.exec("git", [
      "log",
      "-p",
      "--format=",
      "-10",
      "HEAD",
    ]);
    return last.code === 0 ? last.stdout : "";
  }

  async function getDiff(): Promise<string> {
    const staged = await pi.exec("git", ["diff", "--cached"]);
    const unstaged = await pi.exec("git", ["diff"]);
    let combined = "";
    if (staged.stdout.trim()) combined += staged.stdout;
    if (unstaged.stdout.trim()) {
      if (combined) combined += "\n";
      combined += unstaged.stdout;
    }

    const untracked = await pi.exec("git", [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
    if (untracked.stdout.trim()) {
      for (const file of untracked.stdout.trim().split("\n")) {
        if (!file) continue;
        const content = await pi.exec("git", [
          "diff",
          "--no-index",
          "--",
          "/dev/null",
          file,
        ]);
        if (content.stdout.trim()) {
          if (combined) combined += "\n";
          combined += content.stdout;
        }
      }
    }

    return combined;
  }

  function visibleContentLines(): number {
    return Math.max(1, termH - FOOTER_ROWS - CHROME_LINES);
  }

  async function refreshDiff(): Promise<void> {
    if (!diffPanel || !tuiRef) return;
    const raw = await getDiff();
    if (raw.trim()) {
      diffPanel.setFiles(parseDiff(raw));
      diffPanel.setIsClean(false);
    } else {
      diffPanel.setFiles(parseDiff(await getCommitDiff()));
      diffPanel.setIsClean(true);
    }
    tuiRef.requestRender();
  }

  function showPanel(ctx: ExtensionContext): void {
    if (panelVisible || !tuiRef || !themeRef) return;

    diffPanel = new DiffPanel(themeRef);
    overlayHandle = tuiRef.showOverlay(diffPanel, {
      nonCapturing: true,
      anchor: "top-right",
      width: `${Math.round(PANEL_FRACTION * 100)}%`,
      minWidth: PANEL_MIN_WIDTH,
      margin: { right: 0, top: 0, bottom: FOOTER_ROWS },
      visible: (_tw, th) => {
        termH = th;
        if (diffPanel) diffPanel.setMaxVisible(visibleContentLines());
        return true;
      },
    });
    panelVisible = true;

    ctx.ui.setEditorComponent((tui, theme, kb) => {
      return new ConstrainedEditor(tui, theme, kb);
    });

    refreshDiff();
  }

  function hidePanel(ctx?: ExtensionContext): void {
    if (overlayHandle) {
      overlayHandle.hide();
      overlayHandle = null;
    }
    diffPanel = null;
    panelVisible = false;

    const c = ctx || savedCtx;
    if (c) c.ui.setEditorComponent(undefined);
  }

  function togglePanel(ctx: ExtensionContext): void {
    if (!tuiRef) return;
    if (panelVisible) {
      hidePanel(ctx);
      ctx.ui.notify("Diff panel hidden", "info");
    } else {
      showPanel(ctx);
      focusPanel(ctx);
    }
  }

  // Focus mode: open a capturing overlay that proxies input to diffPanel
  function focusPanel(ctx: ExtensionContext): void {
    if (!diffPanel || !panelVisible) return;

    diffPanel.setFocused(true);
    tuiRef?.requestRender();

    // The capturing overlay is invisible (0x0) — it just captures keyboard input
    // and forwards it to diffPanel. On Escape, it calls done() to return to editor.
    const promise = ctx.ui.custom<"unfocus" | "close">(
      (tui, _theme, _kb, done) => {
        return {
          render(_width: number): string[] {
            return [];
          },
          invalidate(): void {},
          handleInput(data: string): void {
            if (
              matchesKey(data, "escape") ||
              matchesKey(data, "q") ||
              matchesKey(data, "alt+f")
            ) {
              diffPanel?.setFocused(false);
              tui.requestRender();
              done("unfocus");
              return;
            }

            if (matchesKey(data, "alt+d")) {
              diffPanel?.setFocused(false);
              done("close");
              return;
            }

            // Forward to diffPanel
            if (!diffPanel) return;

            if (matchesKey(data, "j") || matchesKey(data, "down")) {
              diffPanel.doScroll(1);
            } else if (matchesKey(data, "k") || matchesKey(data, "up")) {
              diffPanel.doScroll(-1);
            } else if (
              matchesKey(data, "pageDown") ||
              matchesKey(data, "ctrl+d")
            ) {
              diffPanel.doScroll(diffPanel.getMaxVisible());
            } else if (
              matchesKey(data, "pageUp") ||
              matchesKey(data, "ctrl+u")
            ) {
              diffPanel.doScroll(-diffPanel.getMaxVisible());
            } else if (matchesKey(data, "home")) {
              diffPanel.doScroll(-diffPanel.getTotalLines());
            } else if (matchesKey(data, "end")) {
              diffPanel.doScroll(diffPanel.getTotalLines());
            } else if (matchesKey(data, "n") || matchesKey(data, "tab")) {
              diffPanel.jumpToFile(1);
            } else if (matchesKey(data, "m") || matchesKey(data, "shift+tab")) {
              diffPanel.jumpToFile(-1);
            } else if (
              matchesKey(data, "return") ||
              matchesKey(data, "e") ||
              matchesKey(data, "space")
            ) {
              diffPanel.toggleFoldCurrent();
            } else if (matchesKey(data, "a")) {
              diffPanel.toggleAllFolds();
            } else {
              return;
            }

            tui.requestRender();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "top-left",
          width: 1,
          maxHeight: 1,
        },
      },
    );

    promise.then((result) => {
      if (diffPanel) {
        diffPanel.setFocused(false);
        tuiRef?.requestRender();
      }
      if (result === "close") {
        hidePanel(ctx);
      }
    });
  }

  function render(): void {
    if (tuiRef) tuiRef.requestRender();
  }

  pi.on("session_start", async (_event, ctx) => {
    savedCtx = ctx;
    ctx.ui.setWidget("diff-tui-ref", (tui, theme) => {
      tuiRef = tui;
      themeRef = theme;
      return { render: () => [], invalidate: () => {} };
    });
  });

  pi.registerCommand("diff", {
    description: "Toggle git diff panel on the right",
    handler: async (_args, ctx) => togglePanel(ctx),
  });

  pi.registerShortcut("alt+d", {
    description: "Toggle git diff panel",
    handler: async (ctx) => togglePanel(ctx),
  });

  pi.registerShortcut("alt+f", {
    description: "Focus diff panel for keyboard navigation",
    handler: async (ctx) => {
      focusPanel(ctx);
    },
  });

  pi.registerShortcut("alt+j", {
    description: "Scroll diff panel down",
    handler: async () => {
      if (!diffPanel) return;
      diffPanel.doScroll(SCROLL_STEP);
      render();
    },
  });

  pi.registerShortcut("alt+k", {
    description: "Scroll diff panel up",
    handler: async () => {
      if (!diffPanel) return;
      diffPanel.doScroll(-SCROLL_STEP);
      render();
    },
  });

  pi.registerShortcut("alt+e", {
    description: "Toggle fold on current diff file",
    handler: async () => {
      if (!diffPanel) return;
      diffPanel.toggleFoldCurrent();
      render();
    },
  });

  pi.on("tool_result", async (event) => {
    if (!panelVisible) return;
    if (["edit", "write", "bash"].includes(event.toolName)) {
      await refreshDiff();
    }
  });

  pi.on("session_shutdown", () => {
    hidePanel();
  });
}

class ConstrainedEditor extends CustomEditor {
  handleInput(data: string): void {
    if (handleReloadShortcut(data, this.onSubmit)) return;
    super.handleInput(data);
  }

  render(width: number): string[] {
    const pw = panelCols(width);
    return super.render(Math.max(40, width - pw));
  }
}

interface FileSection {
  fileIndex: number;
  headerLine: number;
  endLine: number;
}

class DiffPanel {
  private files: DiffFile[] = [];
  private isClean = false;
  private namesOnly = false;
  private expanded = new Set<number>();
  private cursor = 0;
  private scroll = 0;
  private maxVisible = 30;
  private focused = false;
  private contentLines: string[] = [];
  private contentWidth: number | null = null;
  private fileSections: FileSection[] = [];
  private fileStats: Array<{ adds: number; dels: number }> = [];
  private cachedOutput: string[] | null = null;
  private cachedKey: string | null = null;
  private titleLine: string | null = null;

  constructor(private theme: Theme) {}

  getTotalLines(): number {
    return this.contentLines.length;
  }

  getMaxVisible(): number {
    return this.maxVisible;
  }

  setFocused(v: boolean): void {
    this.focused = v;
    this.cachedOutput = null;
    this.cachedKey = null;
  }

  setIsClean(v: boolean): void {
    if (v !== this.isClean) {
      this.isClean = v;
      this.markDirty();
    }
  }

  setFiles(files: DiffFile[]): void {
    const oldPaths = this.files.map((f) => f.path);
    const newExpanded = new Set<number>();
    for (const idx of this.expanded) {
      const oldPath = oldPaths[idx];
      if (oldPath) {
        const newIdx = files.findIndex((f) => f.path === oldPath);
        if (newIdx >= 0) newExpanded.add(newIdx);
      }
    }
    this.expanded = newExpanded;
    this.files = files;
    this.fileStats = files.map((f) => ({
      adds: f.hunks.reduce(
        (n, h) => n + h.lines.filter((l) => l.type === "add").length,
        0,
      ),
      dels: f.hunks.reduce(
        (n, h) => n + h.lines.filter((l) => l.type === "remove").length,
        0,
      ),
    }));
    if (this.cursor >= files.length)
      this.cursor = Math.max(0, files.length - 1);
    this.markDirty();
  }

  doScroll(delta: number): void {
    if (this.contentLines.length === 0) return;
    // Allow scrolling to any line so cursor can reach all files,
    // even when total content fits in the viewport
    const maxScroll = Math.max(0, this.contentLines.length - 1);
    const newScroll = Math.max(0, Math.min(this.scroll + delta, maxScroll));
    if (newScroll === this.scroll) return;
    this.scroll = newScroll;
    this.syncCursorToScroll();
  }

  jumpToFile(delta: number): void {
    if (this.files.length === 0) return;
    const newCursor = Math.max(
      0,
      Math.min(this.cursor + delta, this.files.length - 1),
    );
    if (newCursor === this.cursor) return;
    this.patchCursor(newCursor);
    this.scrollToCursor();
  }

  toggleFoldCurrent(): void {
    if (this.files.length === 0) return;
    if (this.expanded.has(this.cursor)) {
      this.expanded.delete(this.cursor);
    } else {
      this.expanded.add(this.cursor);
    }
    this.markDirty();
  }

  toggleAllFolds(): void {
    if (this.namesOnly) {
      // names-only → collapsed (preview)
      this.namesOnly = false;
      this.expanded.clear();
    } else if (this.expanded.size === 0) {
      // collapsed → expanded
      for (let i = 0; i < this.files.length; i++) {
        this.expanded.add(i);
      }
    } else {
      // expanded → names-only
      this.namesOnly = true;
      this.expanded.clear();
    }
    this.markDirty();
  }

  private syncCursorToScroll(): void {
    let newCursor = 0;
    for (let i = this.fileSections.length - 1; i >= 0; i--) {
      if (this.fileSections[i].headerLine <= this.scroll) {
        newCursor = i;
        break;
      }
    }
    if (newCursor !== this.cursor) {
      this.patchCursor(newCursor);
    } else {
      this.cachedOutput = null;
      this.cachedKey = null;
    }
  }

  private patchCursor(newCursor: number): void {
    const oldCursor = this.cursor;
    this.cursor = newCursor;
    if (this.contentWidth !== null) {
      const oldSection = this.fileSections[oldCursor];
      const newSection = this.fileSections[newCursor];
      if (oldSection && oldSection.headerLine < this.contentLines.length) {
        this.contentLines[oldSection.headerLine] = this.buildHeaderLine(
          oldCursor,
          false,
        );
      }
      if (newSection && newSection.headerLine < this.contentLines.length) {
        this.contentLines[newSection.headerLine] = this.buildHeaderLine(
          newCursor,
          true,
        );
      }
    }
    this.cachedOutput = null;
    this.cachedKey = null;
  }

  private scrollToCursor(): void {
    if (this.fileSections.length === 0) return;
    const section = this.fileSections[this.cursor];
    if (!section) return;

    if (section.headerLine < this.scroll) {
      this.scroll = section.headerLine;
    } else if (section.headerLine >= this.scroll + this.maxVisible) {
      this.scroll = section.headerLine;
    }
  }

  private markDirty(): void {
    this.contentWidth = null;
    this.titleLine = null;
    this.cachedOutput = null;
    this.cachedKey = null;
  }

  setMaxVisible(v: number): void {
    if (v !== this.maxVisible) {
      this.maxVisible = v;
      this.cachedOutput = null;
      this.cachedKey = null;
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const borderColor = this.focused ? "accent" : "border";
    const b = (c: string) => th.fg(borderColor as any, c);

    if (this.contentWidth !== innerW) {
      this.contentLines = this.buildContent(th, innerW);
      this.contentWidth = innerW;
      this.titleLine = this.buildTitle(th, innerW);
      this.scrollToCursor();
    }

    const expandedKey = [...this.expanded].sort().join(",");
    const key = `${width}:${this.scroll}:${this.maxVisible}:${expandedKey}:${this.cursor}:${this.focused}`;
    if (this.cachedOutput && this.cachedKey === key) return this.cachedOutput;

    const hFill = "─".repeat(innerW);
    const borderV = b("│");
    const out: string[] = [];

    out.push(b("╭" + hFill + "╮"));
    out.push(borderV + this.titleLine! + borderV);
    out.push(b("├" + hFill + "┤"));

    const total = this.contentLines.length;
    const visEnd = Math.min(this.scroll + this.maxVisible, total);
    for (let i = this.scroll; i < visEnd; i++) {
      out.push(borderV + this.contentLines[i] + borderV);
    }
    const visCount = visEnd - this.scroll;

    const emptyRow = borderV + " ".repeat(innerW) + borderV;
    for (let i = visCount; i < this.maxVisible; i++) {
      out.push(emptyRow);
    }

    out.push(b("├" + hFill + "┤"));
    const info = total > 0 ? ` ${this.scroll + 1}–${visEnd}/${total}` : "";
    const help = this.focused
      ? `j/k ↑↓ scroll · PgDn/Up · n/m file · Enter fold · a names/preview/full · Esc back${info}`
      : `Alt+F focus · Alt+j/k scroll · Alt+e fold${info}`;
    out.push(borderV + this.pad(th.fg("dim", ` ${help}`), innerW) + borderV);
    out.push(b("╰" + hFill + "╯"));

    this.cachedOutput = out;
    this.cachedKey = key;
    return out;
  }

  invalidate(): void {
    this.markDirty();
  }

  private buildTitle(th: Theme, innerW: number): string {
    const fileCount = this.files.length;
    const totalAdds = this.fileStats.reduce((n, s) => n + s.adds, 0);
    const totalDels = this.fileStats.reduce((n, s) => n + s.dels, 0);

    if (this.isClean) {
      const label = th.fg(
        "accent",
        th.bold("Git worktree is clean, showing commit diffs"),
      );
      const stats = [
        fileCount
          ? th.fg("dim", `${fileCount} file${fileCount === 1 ? "" : "s"} `)
          : "",
        totalAdds ? th.fg("toolDiffAdded", `+${totalAdds} `) : "",
        totalDels ? th.fg("toolDiffRemoved", `-${totalDels} `) : "",
      ]
        .filter(Boolean)
        .join("");
      const left = ` ${label} `;
      const gap = Math.max(
        0,
        innerW - visibleWidth(left) - visibleWidth(stats),
      );
      return this.pad(left + " ".repeat(gap) + stats, innerW);
    }

    const left = ` ${th.fg("accent", th.bold("Git Diff"))} `;
    let right: string;
    if (fileCount > 0) {
      right =
        [
          th.fg("dim", `${fileCount} file${fileCount === 1 ? "" : "s"}`),
          totalAdds ? th.fg("toolDiffAdded", `+${totalAdds}`) : "",
          totalDels ? th.fg("toolDiffRemoved", `-${totalDels}`) : "",
        ]
          .filter(Boolean)
          .join(" ") + " ";
    } else {
      right = th.fg("dim", "clean ");
    }
    const gap = Math.max(0, innerW - visibleWidth(left) - visibleWidth(right));
    return this.pad(left + " ".repeat(gap) + right, innerW);
  }

  private buildHeaderLine(fi: number, active: boolean, width?: number): string {
    const th = this.theme;
    const innerW = width ?? this.contentWidth!;
    const file = this.files[fi];
    const isExpanded = this.expanded.has(fi);
    const foldIcon = isExpanded ? "▼" : this.namesOnly ? "─" : "▶";
    const icon =
      file.status === "new" ? "+" : file.status === "deleted" ? "−" : "~";
    const color =
      file.status === "new"
        ? "toolDiffAdded"
        : file.status === "deleted"
          ? "toolDiffRemoved"
          : "warning";
    const { adds, dels } = this.fileStats[fi];
    const stats = [
      adds ? th.fg("toolDiffAdded", `+${adds}`) : "",
      dels ? th.fg("toolDiffRemoved", `-${dels}`) : "",
    ]
      .filter(Boolean)
      .join(" ");
    const foldColor = active ? "accent" : "dim";
    const pathColor = active ? "accent" : "text";
    const marker = active ? th.fg("accent", "▌") : " ";
    const header =
      `${marker}${th.fg(foldColor as any, foldIcon)} ${th.fg(color as any, icon)} ${th.fg(pathColor as any, th.bold(file.path))}` +
      (stats ? `  ${stats}` : "");
    return this.pad(header, innerW);
  }

  private buildContent(th: Theme, innerW: number): string[] {
    const lines: string[] = [];
    this.fileSections = [];
    const dim = (c: string) => th.fg("dim", c);

    if (this.files.length === 0) {
      lines.push(
        this.pad(
          dim(this.isClean ? " No commits ahead" : " No changes"),
          innerW,
        ),
      );
      return lines;
    }

    for (let fi = 0; fi < this.files.length; fi++) {
      const file = this.files[fi];
      const isExpanded = this.expanded.has(fi);
      const isActive = fi === this.cursor;

      if (fi > 0) lines.push(dim("─".repeat(innerW)));

      const headerLine = lines.length;

      lines.push(this.buildHeaderLine(fi, isActive, innerW));

      if (isExpanded || !this.namesOnly) {
        const diffLines: string[] = [];
        for (const hunk of file.hunks) {
          diffLines.push(this.pad(dim(`  @@ ${hunk.header} @@`), innerW));
          for (const line of hunk.lines) {
            let styled: string;
            if (line.type === "add") {
              const ln = String(line.newNum ?? "").padStart(4);
              styled = `  ${dim(ln)}  ${th.fg("toolDiffAdded", `+ ${line.content}`)}`;
            } else if (line.type === "remove") {
              const ln = String(line.oldNum ?? "").padStart(4);
              styled = `  ${dim(ln)}  ${th.fg("toolDiffRemoved", `- ${line.content}`)}`;
            } else {
              const ln = String(line.newNum ?? "").padStart(4);
              styled = `  ${dim(ln)}  ${th.fg("toolDiffContext", `  ${line.content}`)}`;
            }
            diffLines.push(truncateToWidth(styled, innerW, "…", true));
          }
        }

        if (isExpanded) {
          lines.push(...diffLines);
        } else {
          const preview = diffLines.slice(0, FOLD_PREVIEW);
          lines.push(...preview);
          const remaining = diffLines.length - preview.length;
          if (remaining > 0) {
            lines.push(
              this.pad(
                dim(
                  `  ··· ${remaining} more line${remaining === 1 ? "" : "s"}`,
                ),
                innerW,
              ),
            );
          }
        }
      }

      this.fileSections.push({
        fileIndex: fi,
        headerLine,
        endLine: lines.length - 1,
      });
    }

    return lines;
  }

  private pad(s: string, len: number): string {
    const vis = visibleWidth(s);
    if (vis >= len) return truncateToWidth(s, len, "…", true);
    return s + " ".repeat(len - vis);
  }
}
