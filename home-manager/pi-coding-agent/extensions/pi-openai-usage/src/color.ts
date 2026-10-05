import type { ColorConfig, ColorStop, PiThemeColorToken, UsageColor } from "./config";
import type { ProgressBarSegment } from "./progress-bar";

export type UsageColorMode = "truecolor" | "256color";

export type UsageColorTheme = {
  name?: string;
  fg(color: PiThemeColorToken, text: string): string;
  getColorMode?(): UsageColorMode;
};

export type ColorizeUsageTextOptions = {
  text: string;
  percent: number | null | undefined;
  colors: ColorConfig;
  theme?: UsageColorTheme;
  isLimited?: boolean;
};

export type ColorizeProgressBarSegmentsOptions = {
  segments: readonly ProgressBarSegment[];
  percent: number | null | undefined;
  colors: ColorConfig;
  theme?: UsageColorTheme;
  isLimited?: boolean;
  formatNeutralSegment?: (text: string) => string;
};

const FOREGROUND_RESET = "\x1b[39m";

const PI_THEME_COLOR_TOKENS = new Set<PiThemeColorToken>([
  "success",
  "warning",
  "error",
  "muted",
  "dim",
  "text",
  "accent",
]);

const TRAFFIC_STOPS: ColorStop[] = [
  { percent: 80, color: "#22c55e" },
  { percent: 60, color: "#84cc16" },
  { percent: 40, color: "#eab308" },
  { percent: 20, color: "#f97316" },
  { percent: 0, color: "#ef4444" },
];

const CYAN_DARK_STOPS: ColorStop[] = [
  { percent: 100, color: "#67e8f9" },
  { percent: 75, color: "#22d3ee" },
  { percent: 50, color: "#0891b2" },
  { percent: 25, color: "#155e75" },
  { percent: 0, color: "#334155" },
];

const CYAN_LIGHT_STOPS: ColorStop[] = [
  { percent: 100, color: "#0e7490" },
  { percent: 75, color: "#0891b2" },
  { percent: 50, color: "#155e75" },
  { percent: 25, color: "#164e63" },
  { percent: 0, color: "#334155" },
];

const GREEN_DARK_STOPS: ColorStop[] = [
  { percent: 100, color: "#86efac" },
  { percent: 75, color: "#22c55e" },
  { percent: 50, color: "#65a30d" },
  { percent: 25, color: "#166534" },
  { percent: 0, color: "#374151" },
];

const GREEN_LIGHT_STOPS: ColorStop[] = [
  { percent: 100, color: "#15803d" },
  { percent: 75, color: "#16a34a" },
  { percent: 50, color: "#4d7c0f" },
  { percent: 25, color: "#166534" },
  { percent: 0, color: "#374151" },
];

const MONO_DARK_STOPS: ColorStop[] = [
  { percent: 100, color: "#f8fafc" },
  { percent: 75, color: "#cbd5e1" },
  { percent: 50, color: "#94a3b8" },
  { percent: 25, color: "#64748b" },
  { percent: 0, color: "#475569" },
];

const MONO_LIGHT_STOPS: ColorStop[] = [
  { percent: 100, color: "#111827" },
  { percent: 75, color: "#374151" },
  { percent: 50, color: "#4b5563" },
  { percent: 25, color: "#6b7280" },
  { percent: 0, color: "#9ca3af" },
];

export function colorizeUsageText(options: ColorizeUsageTextOptions): string {
  const color = resolveUsageColor(options);
  if (color === undefined) return options.text;
  return applyForegroundColor(options.theme, color, options.text);
}

export function colorizeProgressBarSegments(options: ColorizeProgressBarSegmentsOptions): string {
  const uncoloredText = options.segments.map((segment) => segment.text).join("");
  if (!shouldApplyBarGradient(options.colors)) return uncoloredText;

  const formatNeutralSegment = options.formatNeutralSegment ?? ((text: string) => text);
  if (options.theme === undefined || !isFiniteNumber(options.percent)) {
    return options.segments.map((segment) => formatNeutralSegment(segment.text)).join("");
  }

  const cellCount = options.segments.length;
  if (cellCount === 0) return "";

  return options.segments
    .map((segment, index) => {
      if (segment.kind === "empty") return formatNeutralSegment(segment.text);

      const cellPercent = gradientCellPercent(
        index,
        cellCount,
        options.colors.barGradient.direction,
      );
      const color = resolveUsageColor({
        percent: cellPercent,
        colors: options.colors,
        theme: options.theme,
        isLimited: options.isLimited,
      });
      return color === undefined
        ? formatNeutralSegment(segment.text)
        : applyForegroundColor(options.theme, color, segment.text);
    })
    .join("");
}

export function resolveUsageColor(options: Omit<ColorizeUsageTextOptions, "text">): UsageColor | undefined {
  const { colors, theme } = options;
  if (theme === undefined || colors.scheme === "none" || colors.target === "none") return undefined;
  if (!isFiniteNumber(options.percent)) return undefined;

  const percent = options.isLimited === true ? 0 : clampNumber(options.percent, 0, 100);
  switch (colors.scheme) {
    case "traffic":
      return selectStepColor(TRAFFIC_STOPS, percent);
    case "cyan":
      return interpolateColorStops(themeIsLight(theme) ? CYAN_LIGHT_STOPS : CYAN_DARK_STOPS, percent);
    case "green":
      return interpolateColorStops(themeIsLight(theme) ? GREEN_LIGHT_STOPS : GREEN_DARK_STOPS, percent);
    case "mono":
      return interpolateColorStops(themeIsLight(theme) ? MONO_LIGHT_STOPS : MONO_DARK_STOPS, percent);
    case "custom":
      return resolveCustomColor(colors.custom.stops, colors.custom.mode, percent);
  }
}

function resolveCustomColor(
  stops: readonly ColorStop[],
  mode: ColorConfig["custom"]["mode"],
  percent: number,
): UsageColor | undefined {
  if (mode === "gradient") return interpolateColorStops(stops, percent);
  return selectStepColor(stops, percent);
}

function shouldApplyBarGradient(colors: ColorConfig): boolean {
  return (
    colors.scheme !== "none" &&
    colors.target !== "none" &&
    colors.target !== "percent" &&
    colors.barGradient.enabled
  );
}

function gradientCellPercent(
  index: number,
  cellCount: number,
  direction: ColorConfig["barGradient"]["direction"],
): number {
  const lowToHighPercent = cellCount <= 1 ? 100 : (index / (cellCount - 1)) * 100;
  return direction === "high-to-low" ? 100 - lowToHighPercent : lowToHighPercent;
}

function applyForegroundColor(theme: UsageColorTheme | undefined, color: UsageColor, text: string): string {
  if (theme === undefined || text.length === 0) return text;

  if (typeof color === "string" && isPiThemeColorToken(color)) {
    return theme.fg(color, text);
  }

  if (typeof color === "number") {
    return `${xtermForeground(color)}${text}${FOREGROUND_RESET}`;
  }

  if (typeof color === "string" && isHexColor(color)) {
    const { r, g, b } = hexToRgb(color);
    if ((theme.getColorMode?.() ?? "truecolor") === "256color") {
      return `${xtermForeground(rgbToXterm256(r, g, b))}${text}${FOREGROUND_RESET}`;
    }
    return `\x1b[38;2;${r};${g};${b}m${text}${FOREGROUND_RESET}`;
  }

  return text;
}

function selectStepColor(stops: readonly ColorStop[], percent: number): UsageColor {
  for (const stop of stops) {
    if (percent >= stop.percent) return stop.color;
  }
  return stops[stops.length - 1]?.color ?? "text";
}

function interpolateColorStops(stops: readonly ColorStop[], percent: number): UsageColor | undefined {
  if (stops.length === 0) return undefined;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) return undefined;
  if (percent >= first.percent) return first.color;
  if (percent <= last.percent) return last.color;

  for (let index = 0; index < stops.length - 1; index += 1) {
    const high = stops[index];
    const low = stops[index + 1];
    if (high === undefined || low === undefined) continue;
    if (percent > high.percent || percent < low.percent) continue;

    const highRgb = usageColorToRgb(high.color);
    const lowRgb = usageColorToRgb(low.color);
    if (highRgb === undefined || lowRgb === undefined) return selectStepColor(stops, percent);

    const ratio = (percent - low.percent) / (high.percent - low.percent);
    return rgbToHex({
      r: Math.round(lowRgb.r + (highRgb.r - lowRgb.r) * ratio),
      g: Math.round(lowRgb.g + (highRgb.g - lowRgb.g) * ratio),
      b: Math.round(lowRgb.b + (highRgb.b - lowRgb.b) * ratio),
    });
  }

  return last.color;
}

function usageColorToRgb(color: UsageColor): Rgb | undefined {
  if (typeof color === "string" && isHexColor(color)) return hexToRgb(color);
  if (typeof color === "number") return xterm256ToRgb(color);
  return undefined;
}

type Rgb = {
  r: number;
  g: number;
  b: number;
};

function themeIsLight(theme: UsageColorTheme): boolean {
  return theme.name === "light";
}

function isPiThemeColorToken(value: string): value is PiThemeColorToken {
  return PI_THEME_COLOR_TOKENS.has(value as PiThemeColorToken);
}

function isHexColor(value: string): value is `#${string}` {
  return /^#[0-9a-fA-F]{6}$/u.test(value);
}

function hexToRgb(hex: `#${string}`): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(rgb: Rgb): `#${string}` {
  return `#${toHexByte(rgb.r)}${toHexByte(rgb.g)}${toHexByte(rgb.b)}`;
}

function toHexByte(value: number): string {
  return clampNumber(value, 0, 255).toString(16).padStart(2, "0");
}

function xtermForeground(index: number): string {
  return `\x1b[38;5;${clampInteger(index, 0, 255)}m`;
}

function rgbToXterm256(r: number, g: number, b: number): number {
  const cube = rgbToColorCubeIndex(r, g, b);
  const gray = rgbToGrayRampIndex(r, g, b);
  return cube.distance <= gray.distance ? cube.index : gray.index;
}

function rgbToColorCubeIndex(r: number, g: number, b: number): { index: number; distance: number } {
  const ri = nearestColorCubeChannel(r);
  const gi = nearestColorCubeChannel(g);
  const bi = nearestColorCubeChannel(b);
  const rr = COLOR_CUBE_CHANNELS[ri] ?? 0;
  const gg = COLOR_CUBE_CHANNELS[gi] ?? 0;
  const bb = COLOR_CUBE_CHANNELS[bi] ?? 0;
  return {
    index: 16 + 36 * ri + 6 * gi + bi,
    distance: weightedRgbDistance(r, g, b, rr, gg, bb),
  };
}

function rgbToGrayRampIndex(r: number, g: number, b: number): { index: number; distance: number } {
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < GRAY_RAMP_CHANNELS.length; index += 1) {
    const value = GRAY_RAMP_CHANNELS[index] ?? 0;
    const distance = weightedRgbDistance(r, g, b, value, value, value);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return { index: 232 + bestIndex, distance: bestDistance };
}

function xterm256ToRgb(index: number): Rgb {
  const clamped = clampInteger(index, 0, 255);
  if (clamped < 16) return ANSI_16_RGB[clamped] ?? { r: 0, g: 0, b: 0 };
  if (clamped >= 232) {
    const gray = GRAY_RAMP_CHANNELS[clamped - 232] ?? 0;
    return { r: gray, g: gray, b: gray };
  }

  const cubeIndex = clamped - 16;
  return {
    r: COLOR_CUBE_CHANNELS[Math.floor(cubeIndex / 36)] ?? 0,
    g: COLOR_CUBE_CHANNELS[Math.floor((cubeIndex % 36) / 6)] ?? 0,
    b: COLOR_CUBE_CHANNELS[cubeIndex % 6] ?? 0,
  };
}

function nearestColorCubeChannel(channel: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < COLOR_CUBE_CHANNELS.length; index += 1) {
    const distance = Math.abs(channel - (COLOR_CUBE_CHANNELS[index] ?? 0));
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function weightedRgbDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  return (r1 - r2) ** 2 * 0.299 + (g1 - g2) ** 2 * 0.587 + (b1 - b2) ** 2 * 0.114;
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

const COLOR_CUBE_CHANNELS = [0, 95, 135, 175, 215, 255] as const;
const GRAY_RAMP_CHANNELS = Array.from({ length: 24 }, (_, index) => 8 + index * 10);
const ANSI_16_RGB: readonly Rgb[] = [
  { r: 0, g: 0, b: 0 },
  { r: 128, g: 0, b: 0 },
  { r: 0, g: 128, b: 0 },
  { r: 128, g: 128, b: 0 },
  { r: 0, g: 0, b: 128 },
  { r: 128, g: 0, b: 128 },
  { r: 0, g: 128, b: 128 },
  { r: 192, g: 192, b: 192 },
  { r: 128, g: 128, b: 128 },
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 255, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
];
