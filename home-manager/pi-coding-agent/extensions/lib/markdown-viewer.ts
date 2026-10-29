import {
  getMarkdownTheme,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

export async function showMarkdownViewModal(
  ctx: ExtensionContext,
  title: string,
  content: string,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("The viewer requires interactive terminal mode.", "warning");
    return;
  }

  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      const md = new Markdown(content, 1, 0, getMarkdownTheme());
      let offset = 0;
      let renderedLines: string[] = [];
      let cachedWidth = 0;

      function getViewportHeight(): number {
        return Math.max(tui.terminal.rows - 8, 5);
      }

      function getMaxOffset(): number {
        return Math.max(0, renderedLines.length - 1);
      }

      return {
        render(width: number): string[] {
          const innerWidth = Math.max(1, width - 2);
          if (width !== cachedWidth) {
            renderedLines = md.render(innerWidth);
            cachedWidth = width;
          }

          const vh = getViewportHeight();
          offset = Math.min(offset, getMaxOffset());
          const visible = renderedLines.slice(offset, offset + vh);
          const scrollText = truncateToWidth(
            getMaxOffset() > 0
              ? ` ${offset + 1}–${Math.min(offset + vh, renderedLines.length)}/${renderedLines.length} `
              : "",
            Math.max(0, Math.floor(innerWidth * 0.4)),
            "…",
          );
          const titleText = truncateToWidth(
            ` 📋 ${title} `,
            Math.max(0, innerWidth - visibleWidth(scrollText)),
            "…",
          );
          const topFill = Math.max(
            0,
            innerWidth - visibleWidth(titleText) - visibleWidth(scrollText),
          );
          const topBorder =
            theme.fg("accent", "╭") +
            theme.fg("accent", theme.bold(titleText)) +
            theme.fg("accent", "─".repeat(topFill)) +
            theme.fg("dim", scrollText) +
            theme.fg("accent", "╮");

          const contentLines = visible.map((line) => {
            const rendered = truncateToWidth(line, innerWidth);
            const pad = Math.max(0, innerWidth - visibleWidth(rendered));
            return (
              theme.fg("accent", "│") +
              rendered +
              " ".repeat(pad) +
              theme.fg("accent", "│")
            );
          });
          for (let i = visible.length; i < vh; i++) {
            contentLines.push(
              theme.fg("accent", "│") +
                " ".repeat(innerWidth) +
                theme.fg("accent", "│"),
            );
          }

          const helpText = truncateToWidth(
            " ↑↓ scroll • PgUp/PgDn page • Home/End jump • Esc close ",
            innerWidth,
            "…",
          );
          const botFill = Math.max(0, innerWidth - visibleWidth(helpText));
          const botBorder =
            theme.fg("accent", "╰") +
            theme.fg("dim", helpText) +
            theme.fg("accent", "─".repeat(botFill)) +
            theme.fg("accent", "╯");

          return [topBorder, ...contentLines, botBorder].map((line) =>
            truncateToWidth(line, width),
          );
        },
        invalidate(): void {
          md.invalidate();
          cachedWidth = 0;
        },
        handleInput(data: string): void {
          const vh = getViewportHeight();
          const maxOff = getMaxOffset();
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
            done();
            return;
          }
          if (matchesKey(data, Key.up)) {
            offset = Math.max(0, offset - 1);
          } else if (matchesKey(data, Key.down)) {
            offset = Math.min(maxOff, offset + 1);
          } else if (matchesKey(data, Key.pageUp)) {
            offset = Math.max(0, offset - vh);
          } else if (matchesKey(data, Key.pageDown)) {
            offset = Math.min(maxOff, offset + vh);
          } else if (matchesKey(data, Key.home)) {
            offset = 0;
          } else if (matchesKey(data, Key.end)) {
            offset = maxOff;
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
        anchor: "center",
        width: "95%",
        maxHeight: "90%",
      },
    },
  );
}
