import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CONFIG_BASENAME = "pi-openai-usage.json";
export const MIN_BAR_WIDTH = 1;
export const MAX_BAR_WIDTH = 40;
export const APPROVED_BAR_WIDTHS = [4, 6, 8, 10, 12, 16, 20] as const;
export const APPROVED_REFRESH_INTERVALS_MS = [
  15_000,
  30_000,
  60_000,
  120_000,
  300_000,
  600_000,
] as const;
export const MIN_REFRESH_INTERVAL_MS = APPROVED_REFRESH_INTERVALS_MS[0];
export const MAX_REFRESH_INTERVAL_MS = APPROVED_REFRESH_INTERVALS_MS[
  APPROVED_REFRESH_INTERVALS_MS.length - 1
];

export type ApprovedBarWidth = (typeof APPROVED_BAR_WIDTHS)[number];
export type ApprovedRefreshIntervalMs = (typeof APPROVED_REFRESH_INTERVALS_MS)[number];
export const APPROVED_REFRESH_INTERVAL_PRESETS = [
  { label: "15s", value: 15_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "2m", value: 120_000 },
  { label: "5m", value: 300_000 },
  { label: "10m", value: 600_000 },
] as const satisfies readonly { label: string; value: ApprovedRefreshIntervalMs }[];

const WINDOW_WIDGET_MODES = ["percent", "bar", "bar-percent", "hidden"] as const;
const RESET_WIDGET_MODES = ["countdown", "clock", "both", "hidden"] as const;
export const BAR_STYLE_PRESETS = ["blocks", "thin", "ascii", "dots", "squares", "braille"] as const;
export const COLOR_SCHEME_PRESETS = ["traffic", "cyan", "green", "mono", "none"] as const;
const BAR_STYLES = [...BAR_STYLE_PRESETS, "custom"] as const;
const COLOR_SCHEMES = [...COLOR_SCHEME_PRESETS, "custom"] as const;
const COLOR_TARGETS = ["value", "widget", "bar", "percent", "none"] as const;
const COLOR_SCALE_MODES = ["step", "gradient"] as const;
const BAR_GRADIENT_DIRECTIONS = ["low-to-high", "high-to-low"] as const;
const PI_THEME_COLOR_TOKENS = [
  "success",
  "warning",
  "error",
  "muted",
  "dim",
  "text",
  "accent",
] as const;

export type WindowWidgetMode = (typeof WINDOW_WIDGET_MODES)[number];
export type ResetWidgetMode = (typeof RESET_WIDGET_MODES)[number];
export type BarStylePreset = (typeof BAR_STYLE_PRESETS)[number];
export type ColorSchemePreset = (typeof COLOR_SCHEME_PRESETS)[number];
export type BarStyleName = (typeof BAR_STYLES)[number];
export type ColorSchemeName = (typeof COLOR_SCHEMES)[number];
export type ColorTarget = (typeof COLOR_TARGETS)[number];
export type ColorScaleMode = (typeof COLOR_SCALE_MODES)[number];
export type BarGradientDirection = (typeof BAR_GRADIENT_DIRECTIONS)[number];
export type PiThemeColorToken = (typeof PI_THEME_COLOR_TOKENS)[number];
export type UsageColor = PiThemeColorToken | `#${string}` | number;

export type DisplayConfig = {
  showAlways: boolean;
  showLabel: boolean;
  label: string;
  separator: string;
};

export type WindowWidgetConfig = {
  enabled: boolean;
  label: string;
  mode: WindowWidgetMode;
};

export type ResetWidgetConfig = {
  enabled: boolean;
  label: string;
  mode: ResetWidgetMode;
};

export type WidgetConfig = {
  fiveHour: WindowWidgetConfig;
  sevenDay: WindowWidgetConfig;
  fiveHourReset: ResetWidgetConfig;
  sevenDayReset: ResetWidgetConfig;
};

export type CustomBarStyleConfig = {
  filled: string;
  empty: string;
  partials: string[];
};

export type BarConfig = {
  style: BarStyleName;
  width: number;
  partials: boolean;
  custom: CustomBarStyleConfig;
};

export type ColorStop = {
  percent: number;
  color: UsageColor;
  label?: string;
};

export type CustomColorConfig = {
  mode: ColorScaleMode;
  stops: ColorStop[];
};

export type BarGradientConfig = {
  enabled: boolean;
  direction: BarGradientDirection;
};

export type ColorConfig = {
  scheme: ColorSchemeName;
  target: ColorTarget;
  barGradient: BarGradientConfig;
  custom: CustomColorConfig;
};

export type UsageConfig = {
  enabled: boolean;
  refreshIntervalMs: number;
  display: DisplayConfig;
  widgets: WidgetConfig;
  bar: BarConfig;
  colors: ColorConfig;
};

export type ConfigPaths = {
  project: string;
  global: string;
};

export type LoadUsageConfigOptions = {
  cwd?: string;
  home?: string;
};

export type LoadedUsageConfig = {
  configPath: string;
  projectConfigPath: string;
  globalConfigPath: string;
  projectConfigExists: boolean;
  globalConfigExists: boolean;
  raw: {
    project: Record<string, unknown>;
    global: Record<string, unknown>;
  };
  effective: UsageConfig;
};

export type WindowWidgetConfigPatch = Partial<WindowWidgetConfig>;
export type ResetWidgetConfigPatch = Partial<ResetWidgetConfig>;

export type UsageConfigPatch = {
  enabled?: boolean;
  refreshIntervalMs?: ApprovedRefreshIntervalMs;
  display?: Partial<DisplayConfig>;
  widgets?: Partial<{
    fiveHour: WindowWidgetConfigPatch;
    sevenDay: WindowWidgetConfigPatch;
    fiveHourReset: ResetWidgetConfigPatch;
    sevenDayReset: ResetWidgetConfigPatch;
  }>;
  bar?: Partial<{
    style: BarStyleName;
    width: ApprovedBarWidth;
    partials: boolean;
    custom: Partial<CustomBarStyleConfig>;
  }>;
  colors?: Partial<{
    scheme: ColorSchemeName;
    target: ColorTarget;
    barGradient: Partial<BarGradientConfig>;
    custom: Partial<CustomColorConfig>;
  }>;
};

const DEFAULT_COLOR_STOPS: ColorStop[] = [
  { percent: 80, color: "#22c55e", label: "green" },
  { percent: 60, color: "#84cc16", label: "lime" },
  { percent: 40, color: "#eab308", label: "yellow" },
  { percent: 20, color: "#f97316", label: "orange" },
  { percent: 0, color: "#ef4444", label: "red" },
];

export const DEFAULT_USAGE_CONFIG: UsageConfig = {
  enabled: true,
  refreshIntervalMs: 60_000,
  display: {
    showAlways: false,
    showLabel: true,
    label: "Usage",
    separator: " | ",
  },
  widgets: {
    fiveHour: { enabled: true, label: "5h", mode: "bar-percent" },
    sevenDay: { enabled: true, label: "7d", mode: "bar-percent" },
    fiveHourReset: { enabled: true, label: "5h ↺", mode: "countdown" },
    sevenDayReset: { enabled: true, label: "7d ↺", mode: "countdown" },
  },
  bar: {
    style: "blocks",
    width: 10,
    partials: true,
    custom: {
      filled: "▰",
      empty: "▱",
      partials: [],
    },
  },
  colors: {
    scheme: "traffic",
    target: "value",
    barGradient: {
      enabled: false,
      direction: "low-to-high",
    },
    custom: {
      mode: "step",
      stops: cloneColorStops(DEFAULT_COLOR_STOPS),
    },
  },
};

export function usageConfigPaths(options: LoadUsageConfigOptions = {}): ConfigPaths {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();

  return {
    project: join(cwd, ".pi", "extensions", CONFIG_BASENAME),
    global: join(home, ".pi", "agent", "extensions", CONFIG_BASENAME),
  };
}

export function loadUsageConfig(options: LoadUsageConfigOptions = {}): LoadedUsageConfig {
  const paths = usageConfigPaths(options);
  const projectConfigExists = existsSync(paths.project);
  const globalConfigExists = existsSync(paths.global);
  const globalRaw = readRawConfig(paths.global);
  const projectRaw = readRawConfig(paths.project);

  return {
    configPath: projectConfigExists ? paths.project : paths.global,
    projectConfigPath: paths.project,
    globalConfigPath: paths.global,
    projectConfigExists,
    globalConfigExists,
    raw: {
      project: projectRaw,
      global: globalRaw,
    },
    effective: normalizeUsageConfig(projectRaw, globalRaw),
  };
}

export function patchUsageConfig(configPath: string, patch: UsageConfigPatch): void {
  const current = readRawConfig(configPath);
  const next = mergeKnownConfigPatch(current, patch, "root");
  writeRawConfig(configPath, next);
}

export function readRawConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeUsageConfig(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
): UsageConfig {
  return {
    enabled: configValue(projectRaw, globalRaw, ["enabled"], isBoolean, DEFAULT_USAGE_CONFIG.enabled),
    refreshIntervalMs: configValue(
      projectRaw,
      globalRaw,
      ["refreshIntervalMs"],
      isApprovedRefreshIntervalMs,
      DEFAULT_USAGE_CONFIG.refreshIntervalMs,
    ),
    display: normalizeDisplayConfig(projectRaw, globalRaw),
    widgets: normalizeWidgetConfig(projectRaw, globalRaw),
    bar: normalizeBarConfig(projectRaw, globalRaw),
    colors: normalizeColorConfig(projectRaw, globalRaw),
  };
}

function normalizeDisplayConfig(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
): DisplayConfig {
  return {
    showAlways: configValue(
      projectRaw,
      globalRaw,
      ["display", "showAlways"],
      isBoolean,
      DEFAULT_USAGE_CONFIG.display.showAlways,
    ),
    showLabel: configValue(
      projectRaw,
      globalRaw,
      ["display", "showLabel"],
      isBoolean,
      DEFAULT_USAGE_CONFIG.display.showLabel,
    ),
    label: configValue(
      projectRaw,
      globalRaw,
      ["display", "label"],
      isNonEmptyString,
      DEFAULT_USAGE_CONFIG.display.label,
    ),
    separator: configValue(
      projectRaw,
      globalRaw,
      ["display", "separator"],
      isString,
      DEFAULT_USAGE_CONFIG.display.separator,
    ),
  };
}

function normalizeWidgetConfig(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
): WidgetConfig {
  return {
    fiveHour: normalizeWindowWidgetConfig(projectRaw, globalRaw, "fiveHour"),
    sevenDay: normalizeWindowWidgetConfig(projectRaw, globalRaw, "sevenDay"),
    fiveHourReset: normalizeResetWidgetConfig(projectRaw, globalRaw, "fiveHourReset"),
    sevenDayReset: normalizeResetWidgetConfig(projectRaw, globalRaw, "sevenDayReset"),
  };
}

function normalizeWindowWidgetConfig(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
  widgetName: "fiveHour" | "sevenDay",
): WindowWidgetConfig {
  const defaults = DEFAULT_USAGE_CONFIG.widgets[widgetName];

  return {
    enabled: configValue(
      projectRaw,
      globalRaw,
      ["widgets", widgetName, "enabled"],
      isBoolean,
      defaults.enabled,
    ),
    label: configValue(
      projectRaw,
      globalRaw,
      ["widgets", widgetName, "label"],
      isNonEmptyString,
      defaults.label,
    ),
    mode: configValue(
      projectRaw,
      globalRaw,
      ["widgets", widgetName, "mode"],
      isWindowWidgetMode,
      defaults.mode,
    ),
  };
}

function normalizeResetWidgetConfig(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
  widgetName: "fiveHourReset" | "sevenDayReset",
): ResetWidgetConfig {
  const defaults = DEFAULT_USAGE_CONFIG.widgets[widgetName];

  return {
    enabled: configValue(
      projectRaw,
      globalRaw,
      ["widgets", widgetName, "enabled"],
      isBoolean,
      defaults.enabled,
    ),
    label: configValue(
      projectRaw,
      globalRaw,
      ["widgets", widgetName, "label"],
      isNonEmptyString,
      defaults.label,
    ),
    mode: configValue(
      projectRaw,
      globalRaw,
      ["widgets", widgetName, "mode"],
      isResetWidgetMode,
      defaults.mode,
    ),
  };
}

function normalizeBarConfig(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
): BarConfig {
  return {
    style: configValue(
      projectRaw,
      globalRaw,
      ["bar", "style"],
      isBarStyleName,
      DEFAULT_USAGE_CONFIG.bar.style,
    ),
    width: configValue(
      projectRaw,
      globalRaw,
      ["bar", "width"],
      isApprovedBarWidth,
      DEFAULT_USAGE_CONFIG.bar.width,
    ),
    partials: configValue(
      projectRaw,
      globalRaw,
      ["bar", "partials"],
      isBoolean,
      DEFAULT_USAGE_CONFIG.bar.partials,
    ),
    custom: {
      filled: configValue(
        projectRaw,
        globalRaw,
        ["bar", "custom", "filled"],
        isNonEmptyString,
        DEFAULT_USAGE_CONFIG.bar.custom.filled,
      ),
      empty: configValue(
        projectRaw,
        globalRaw,
        ["bar", "custom", "empty"],
        isNonEmptyString,
        DEFAULT_USAGE_CONFIG.bar.custom.empty,
      ),
      partials: normalizeStringArray(
        firstConfigValue(
          projectRaw,
          globalRaw,
          ["bar", "custom", "partials"],
          Array.isArray,
        ),
        DEFAULT_USAGE_CONFIG.bar.custom.partials,
      ),
    },
  };
}

function normalizeColorConfig(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
): ColorConfig {
  const customMode = configValue(
    projectRaw,
    globalRaw,
    ["colors", "custom", "mode"],
    isColorScaleMode,
    DEFAULT_USAGE_CONFIG.colors.custom.mode,
  );
  const rawStops = firstConfigValue(
    projectRaw,
    globalRaw,
    ["colors", "custom", "stops"],
    Array.isArray,
  );
  const customStops = Array.isArray(rawStops) ? normalizeColorStops(rawStops, customMode) : [];
  const custom =
    customStops.length > 0
      ? { mode: customMode, stops: customStops }
      : cloneDefaultCustomColorConfig();

  return {
    scheme: configValue(
      projectRaw,
      globalRaw,
      ["colors", "scheme"],
      isColorSchemeName,
      DEFAULT_USAGE_CONFIG.colors.scheme,
    ),
    target: configValue(
      projectRaw,
      globalRaw,
      ["colors", "target"],
      isColorTarget,
      DEFAULT_USAGE_CONFIG.colors.target,
    ),
    barGradient: {
      enabled: configValue(
        projectRaw,
        globalRaw,
        ["colors", "barGradient", "enabled"],
        isBoolean,
        DEFAULT_USAGE_CONFIG.colors.barGradient.enabled,
      ),
      direction: configValue(
        projectRaw,
        globalRaw,
        ["colors", "barGradient", "direction"],
        isBarGradientDirection,
        DEFAULT_USAGE_CONFIG.colors.barGradient.direction,
      ),
    },
    custom,
  };
}

function normalizeColorStops(rawStops: readonly unknown[], mode: ColorScaleMode): ColorStop[] {
  return rawStops
    .map((stop): ColorStop | undefined => normalizeColorStop(stop, mode))
    .filter((stop): stop is ColorStop => stop !== undefined)
    .sort((left, right) => right.percent - left.percent);
}

function normalizeColorStop(rawStop: unknown, mode: ColorScaleMode): ColorStop | undefined {
  if (!isRecord(rawStop)) return undefined;
  if (!isFiniteNumber(rawStop.percent)) return undefined;
  if (!isValidUsageColor(rawStop.color, mode)) return undefined;

  const color = rawStop.color as UsageColor;
  const label = typeof rawStop.label === "string" ? rawStop.label.trim() : "";
  const normalized: ColorStop = {
    percent: clampNumber(rawStop.percent, 0, 100),
    color,
  };
  if (label.length > 0) normalized.label = label;
  return normalized;
}

function isValidUsageColor(value: unknown, mode: ColorScaleMode): value is UsageColor {
  if (isXtermColor(value) || isHexColor(value)) return true;
  return mode === "step" && isPiThemeColorToken(value);
}

function normalizeStringArray(rawValue: unknown, defaultValue: string[]): string[] {
  if (!Array.isArray(rawValue)) return [...defaultValue];

  return rawValue.filter((entry): entry is string => isNonEmptyString(entry));
}

function configValue<T>(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
  path: readonly string[],
  predicate: (value: unknown) => value is T,
  defaultValue: T,
): T {
  return firstConfigValue(projectRaw, globalRaw, path, predicate) ?? defaultValue;
}

function firstConfigValue<T>(
  projectRaw: Record<string, unknown>,
  globalRaw: Record<string, unknown>,
  path: readonly string[],
  predicate: (value: unknown) => value is T,
): T | undefined {
  const projectValue = valueAtPath(projectRaw, path);
  if (predicate(projectValue)) return projectValue;

  const globalValue = valueAtPath(globalRaw, path);
  if (predicate(globalValue)) return globalValue;

  return undefined;
}

function valueAtPath(record: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function writeRawConfig(configPath: string, config: Record<string, unknown>): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

type PatchBranch =
  | "root"
  | "display"
  | "widgets"
  | "windowWidget"
  | "resetWidget"
  | "bar"
  | "customBar"
  | "colors"
  | "barGradient"
  | "customColors";

function mergeKnownConfigPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  branch: PatchBranch,
): Record<string, unknown> {
  const next = { ...current };
  const allowedKeys = knownPatchKeys(branch);

  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined || !allowedKeys.has(key)) continue;

    const childBranch = childPatchBranch(branch, key);
    if (childBranch !== undefined && isRecord(patchValue)) {
      const currentChild = isRecord(next[key]) ? next[key] : {};
      next[key] = mergeKnownConfigPatch(currentChild, patchValue, childBranch);
      continue;
    }

    next[key] = patchValue;
  }

  return next;
}

function knownPatchKeys(branch: PatchBranch): ReadonlySet<string> {
  switch (branch) {
    case "root":
      return new Set(["enabled", "refreshIntervalMs", "display", "widgets", "bar", "colors"]);
    case "display":
      return new Set(["showAlways", "showLabel", "label", "separator"]);
    case "widgets":
      return new Set(["fiveHour", "sevenDay", "fiveHourReset", "sevenDayReset"]);
    case "windowWidget":
    case "resetWidget":
      return new Set(["enabled", "label", "mode"]);
    case "bar":
      return new Set(["style", "width", "partials", "custom"]);
    case "customBar":
      return new Set(["filled", "empty", "partials"]);
    case "colors":
      return new Set(["scheme", "target", "barGradient", "custom"]);
    case "barGradient":
      return new Set(["enabled", "direction"]);
    case "customColors":
      return new Set(["mode", "stops"]);
  }
}

function childPatchBranch(parent: PatchBranch, key: string): PatchBranch | undefined {
  if (parent === "root" && key === "display") return "display";
  if (parent === "root" && key === "widgets") return "widgets";
  if (parent === "widgets" && (key === "fiveHour" || key === "sevenDay")) return "windowWidget";
  if (parent === "widgets" && (key === "fiveHourReset" || key === "sevenDayReset")) {
    return "resetWidget";
  }
  if (parent === "root" && key === "bar") return "bar";
  if (parent === "bar" && key === "custom") return "customBar";
  if (parent === "root" && key === "colors") return "colors";
  if (parent === "colors" && key === "barGradient") return "barGradient";
  if (parent === "colors" && key === "custom") return "customColors";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isApprovedBarWidth(value: unknown): value is ApprovedBarWidth {
  return includesNumber(APPROVED_BAR_WIDTHS, value);
}

function isApprovedRefreshIntervalMs(value: unknown): value is ApprovedRefreshIntervalMs {
  return includesNumber(APPROVED_REFRESH_INTERVALS_MS, value);
}

function isWindowWidgetMode(value: unknown): value is WindowWidgetMode {
  return includesString(WINDOW_WIDGET_MODES, value);
}

function isResetWidgetMode(value: unknown): value is ResetWidgetMode {
  return includesString(RESET_WIDGET_MODES, value);
}

function isBarStyleName(value: unknown): value is BarStyleName {
  return includesString(BAR_STYLES, value);
}

function isColorSchemeName(value: unknown): value is ColorSchemeName {
  return includesString(COLOR_SCHEMES, value);
}

function isColorTarget(value: unknown): value is ColorTarget {
  return includesString(COLOR_TARGETS, value);
}

function isColorScaleMode(value: unknown): value is ColorScaleMode {
  return includesString(COLOR_SCALE_MODES, value);
}

function isBarGradientDirection(value: unknown): value is BarGradientDirection {
  return includesString(BAR_GRADIENT_DIRECTIONS, value);
}

function isPiThemeColorToken(value: unknown): value is PiThemeColorToken {
  return includesString(PI_THEME_COLOR_TOKENS, value);
}

function includesString<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function includesNumber<const T extends readonly number[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "number" && values.some((candidate) => candidate === value);
}

function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/u.test(value);
}

function isXtermColor(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

function clampInteger(value: number, min: number, max: number): number {
  return clampNumber(Math.round(value), min, max);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneDefaultCustomColorConfig(): CustomColorConfig {
  return {
    mode: DEFAULT_USAGE_CONFIG.colors.custom.mode,
    stops: cloneColorStops(DEFAULT_COLOR_STOPS),
  };
}

function cloneColorStops(stops: readonly ColorStop[]): ColorStop[] {
  return stops.map((stop) => ({ ...stop }));
}
