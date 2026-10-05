import {
  MAX_BAR_WIDTH,
  MIN_BAR_WIDTH,
  type BarConfig,
  type BarStyleName,
  type CustomBarStyleConfig,
} from "./config";
import { isSingleCellGlyph } from "./display-width";

export type ProgressBarStyle = {
  filled: string;
  empty: string;
  partials: string[];
};

export type ProgressBarSegmentKind = "filled" | "partial" | "empty";

export type ProgressBarSegment = {
  text: string;
  kind: ProgressBarSegmentKind;
};

type BuiltInBarStyleName = Exclude<BarStyleName, "custom">;

export const BUILT_IN_BAR_STYLES: Record<BuiltInBarStyleName, ProgressBarStyle> = {
  blocks: {
    filled: "█",
    empty: "░",
    partials: ["▏", "▎", "▍", "▌", "▋", "▊", "▉"],
  },
  thin: { filled: "━", empty: "─", partials: [] },
  ascii: { filled: "#", empty: "-", partials: [] },
  dots: { filled: "●", empty: "○", partials: [] },
  squares: { filled: "■", empty: "□", partials: [] },
  braille: {
    filled: "⣿",
    empty: "⠀",
    partials: ["⣀", "⣤", "⣶"],
  },
};

/**
 * Renders a fixed-width text progress bar.
 *
 * The renderer is pure display text logic: it has no theme, color, or Pi UI knowledge.
 * A null or unavailable percent renders an empty bar while preserving configured width.
 */
export function renderProgressBar(percent: number | null | undefined, config: BarConfig): string {
  return renderProgressBarSegments(percent, config)
    .map((segment) => segment.text)
    .join("");
}

/**
 * Exposes fixed-width bar cells for callers that layer colors over selected cells.
 *
 * Segmenting remains pure progress-bar ownership: callers decide whether and how to
 * color filled, partial, or empty cells.
 */
export function renderProgressBarSegments(
  percent: number | null | undefined,
  config: BarConfig,
): ProgressBarSegment[] {
  const width = clampInteger(config.width, MIN_BAR_WIDTH, MAX_BAR_WIDTH);
  const style = resolveBarStyle(config);

  if (!isFiniteNumber(percent)) return emptySegments(width, style);

  const filledCells = (clampNumber(percent, 0, 100) / 100) * width;
  if (config.partials && style.partials.length > 0) {
    return renderPartialBarSegments(filledCells, width, style);
  }

  return renderFullCellBarSegments(Math.round(filledCells), width, style);
}

function renderPartialBarSegments(
  filledCells: number,
  width: number,
  style: ProgressBarStyle,
): ProgressBarSegment[] {
  const fullCells = Math.min(width, Math.floor(filledCells));
  const fractionalCell = filledCells - fullCells;

  if (fullCells >= width || fractionalCell <= Number.EPSILON) {
    return renderFullCellBarSegments(fullCells, width, style);
  }

  const partialCell = partialCellForFraction(fractionalCell, style.partials);
  const emptyCells = width - fullCells - 1;
  return [
    ...repeatSegments(style.filled, fullCells, "filled"),
    { text: partialCell, kind: "partial" },
    ...repeatSegments(style.empty, emptyCells, "empty"),
  ];
}

function renderFullCellBarSegments(
  filledCells: number,
  width: number,
  style: ProgressBarStyle,
): ProgressBarSegment[] {
  const clampedFilledCells = clampInteger(filledCells, 0, width);
  return [
    ...repeatSegments(style.filled, clampedFilledCells, "filled"),
    ...repeatSegments(style.empty, width - clampedFilledCells, "empty"),
  ];
}

function emptySegments(width: number, style: ProgressBarStyle): ProgressBarSegment[] {
  return repeatSegments(style.empty, width, "empty");
}

function repeatSegments(
  text: string,
  count: number,
  kind: ProgressBarSegmentKind,
): ProgressBarSegment[] {
  return Array.from({ length: Math.max(0, count) }, () => ({ text, kind }));
}

function partialCellForFraction(fraction: number, partials: readonly string[]): string {
  const index = clampInteger(Math.ceil(fraction * (partials.length + 1)) - 1, 0, partials.length - 1);
  return partials[index] ?? partials[partials.length - 1] ?? "";
}

function resolveBarStyle(config: BarConfig): ProgressBarStyle {
  if (config.style === "custom") return customBarStyle(config.custom);
  return BUILT_IN_BAR_STYLES[config.style] ?? BUILT_IN_BAR_STYLES.blocks;
}

function customBarStyle(custom: CustomBarStyleConfig): ProgressBarStyle {
  return {
    filled: singleCellGlyph(custom.filled, DEFAULT_CUSTOM_BAR_STYLE.filled),
    empty: singleCellGlyph(custom.empty, DEFAULT_CUSTOM_BAR_STYLE.empty),
    partials: custom.partials
      .map((partial) => singleCellGlyph(partial, ""))
      .filter((partial) => partial.length > 0),
  };
}

function singleCellGlyph(value: string, fallback: string): string {
  const [firstGlyph] = Array.from(value);
  if (firstGlyph !== undefined && isSingleCellGlyph(firstGlyph)) return firstGlyph;
  return fallback;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampInteger(value: number, min: number, max: number): number {
  return clampNumber(Math.round(value), min, max);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const DEFAULT_CUSTOM_BAR_STYLE: Pick<ProgressBarStyle, "filled" | "empty"> = {
  filled: "▰",
  empty: "▱",
};
