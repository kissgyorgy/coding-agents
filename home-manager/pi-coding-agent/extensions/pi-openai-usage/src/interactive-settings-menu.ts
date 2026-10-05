import { SettingsList, type SettingItem, type SettingsListTheme } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  APPROVED_BAR_WIDTHS,
  APPROVED_REFRESH_INTERVAL_PRESETS,
  BAR_STYLE_PRESETS,
  COLOR_SCHEME_PRESETS,
  type ApprovedBarWidth,
  type ApprovedRefreshIntervalMs,
  type BarStylePreset,
  type ColorSchemePreset,
  type ResetWidgetConfig,
  type ResetWidgetConfigPatch,
  type ResetWidgetMode,
  type UsageConfig,
  type UsageConfigPatch,
  type WindowWidgetConfig,
  type WindowWidgetConfigPatch,
  type WindowWidgetMode,
} from "./config";

type InteractiveSettingsMenuContext = Pick<ExtensionCommandContext, "ui">;

type PiTheme = {
  fg?: (color: string, text: string) => string;
};

export type InteractiveSettingsMenuCallbacks = {
  onCancel?: () => void;
  onChange?: (id: string, newValue: string) => void;
  onPatch?: (patch: UsageConfigPatch) => void;
  theme?: SettingsListTheme;
};

type SettingPatchBuilder = (value: string) => UsageConfigPatch | undefined;

const DISPLAY_VALUES = ["On", "Off", "Always"] as const;
type DisplayValue = (typeof DISPLAY_VALUES)[number];
const WINDOW_WIDGET_VALUES = ["hidden", "percent", "bar", "bar + percent"] as const;
type WindowWidgetValue = (typeof WINDOW_WIDGET_VALUES)[number];
const RESET_WIDGET_VALUES = ["hidden", "countdown", "clock", "both"] as const;
type ResetWidgetValue = (typeof RESET_WIDGET_VALUES)[number];
const HIDE_LABEL_VALUES = ["No", "Yes"] as const;
type HideLabelValue = (typeof HIDE_LABEL_VALUES)[number];
const WINDOW_WIDGET_MODE_BY_VALUE: Record<WindowWidgetValue, WindowWidgetMode> = {
  hidden: "hidden",
  percent: "percent",
  bar: "bar",
  "bar + percent": "bar-percent",
};
const RESET_WIDGET_MODE_BY_VALUE: Record<ResetWidgetValue, ResetWidgetMode> = {
  hidden: "hidden",
  countdown: "countdown",
  clock: "clock",
  both: "both",
};
const BAR_WIDTH_VALUES = APPROVED_BAR_WIDTHS.map(String);
const BAR_WIDTH_BY_VALUE = new Map<string, ApprovedBarWidth>(
  APPROVED_BAR_WIDTHS.map((width) => [String(width), width] as const),
);
const REFRESH_INTERVAL_VALUES = APPROVED_REFRESH_INTERVAL_PRESETS.map(({ label }) => label);
const REFRESH_INTERVAL_BY_VALUE = new Map<string, ApprovedRefreshIntervalMs>(
  APPROVED_REFRESH_INTERVAL_PRESETS.map(({ label, value }) => [label, value] as const),
);

type WindowWidgetKey = "fiveHour" | "sevenDay";
type ResetWidgetKey = "fiveHourReset" | "sevenDayReset";

const SETTING_PATCH_BUILDERS: Record<string, SettingPatchBuilder> = {
  display: displayPatchForValue,
  "color-scheme": colorSchemePatchForValue,
  "bar-style": barStylePatchForValue,
  "bar-width": barWidthPatchForValue,
  "five-hour-display": windowWidgetPatchBuilder("fiveHour"),
  "seven-day-display": windowWidgetPatchBuilder("sevenDay"),
  "five-hour-reset-display": resetWidgetPatchBuilder("fiveHourReset"),
  "seven-day-reset-display": resetWidgetPatchBuilder("sevenDayReset"),
  "refresh-interval": refreshIntervalPatchForValue,
  "hide-label": hideLabelPatchForValue,
};

export async function openInteractiveSettingsMenu(
  ctx: InteractiveSettingsMenuContext,
  config: UsageConfig,
  callbacks: InteractiveSettingsMenuCallbacks = {},
): Promise<void> {
  await ctx.ui.custom<void>((_tui, theme, _keybindings, done) =>
    createInteractiveSettingsMenu(config, {
      ...callbacks,
      onCancel: () => {
        callbacks.onCancel?.();
        done(undefined);
      },
      theme: createSettingsListTheme(theme as PiTheme),
    }),
  );
}

export function createInteractiveSettingsMenu(
  config: UsageConfig,
  callbacks: InteractiveSettingsMenuCallbacks = {},
): SettingsList {
  const rows = buildInteractiveSettingsRows(config);
  return new SettingsList(
    rows,
    rows.length,
    callbacks.theme ?? createSettingsListTheme(),
    createChangeHandler(callbacks),
    callbacks.onCancel ?? (() => undefined),
  );
}

export function configPatchForInteractiveSetting(
  id: string,
  newValue: string,
): UsageConfigPatch | undefined {
  return SETTING_PATCH_BUILDERS[id]?.(newValue);
}

export function buildInteractiveSettingsRows(config: UsageConfig): SettingItem[] {
  return [
    {
      id: "display",
      label: "Display",
      currentValue: formatDisplayValue(config),
      values: [...DISPLAY_VALUES],
    },
    {
      id: "color-scheme",
      label: "Color scheme",
      currentValue: formatJsonOnlyCustomValue(config.colors.scheme),
      values: [...COLOR_SCHEME_PRESETS],
    },
    {
      id: "bar-style",
      label: "Bar style",
      currentValue: formatJsonOnlyCustomValue(config.bar.style),
      values: [...BAR_STYLE_PRESETS],
    },
    {
      id: "bar-width",
      label: "Bar width",
      currentValue: String(config.bar.width),
      values: [...BAR_WIDTH_VALUES],
    },
    buildWindowWidgetRow("five-hour-display", "5h display", config.widgets.fiveHour),
    buildWindowWidgetRow("seven-day-display", "7d display", config.widgets.sevenDay),
    buildResetWidgetRow(
      "five-hour-reset-display",
      "5h reset display",
      config.widgets.fiveHourReset,
    ),
    buildResetWidgetRow(
      "seven-day-reset-display",
      "7d reset display",
      config.widgets.sevenDayReset,
    ),
    {
      id: "refresh-interval",
      label: "Refresh interval",
      currentValue: formatRefreshInterval(config.refreshIntervalMs),
      values: [...REFRESH_INTERVAL_VALUES],
    },
    {
      id: "hide-label",
      label: "Hide label",
      currentValue: config.display.showLabel ? "No" : "Yes",
      values: [...HIDE_LABEL_VALUES],
    },
  ];
}

function buildWindowWidgetRow(
  id: string,
  label: string,
  widget: WindowWidgetConfig,
): SettingItem {
  return {
    id,
    label,
    currentValue: formatWindowWidgetValue(widget),
    values: [...WINDOW_WIDGET_VALUES],
  };
}

function buildResetWidgetRow(id: string, label: string, widget: ResetWidgetConfig): SettingItem {
  return {
    id,
    label,
    currentValue: formatResetWidgetValue(widget),
    values: [...RESET_WIDGET_VALUES],
  };
}

function createChangeHandler(
  callbacks: InteractiveSettingsMenuCallbacks,
): (id: string, newValue: string) => void {
  return (id, newValue) => {
    callbacks.onChange?.(id, newValue);

    const patch = configPatchForInteractiveSetting(id, newValue);
    if (patch !== undefined) callbacks.onPatch?.(patch);
  };
}

function displayPatchForValue(value: string): UsageConfigPatch | undefined {
  if (!isDisplayValue(value)) return undefined;

  switch (value) {
    case "On":
      return { enabled: true, display: { showAlways: false } };
    case "Off":
      return { enabled: false, display: { showAlways: false } };
    case "Always":
      return { enabled: true, display: { showAlways: true } };
  }
}

function colorSchemePatchForValue(value: string): UsageConfigPatch | undefined {
  if (!isColorSchemePreset(value)) return undefined;
  return { colors: { scheme: value } };
}

function barStylePatchForValue(value: string): UsageConfigPatch | undefined {
  if (!isBarStylePreset(value)) return undefined;
  return { bar: { style: value } };
}

function barWidthPatchForValue(value: string): UsageConfigPatch | undefined {
  const width = BAR_WIDTH_BY_VALUE.get(value);
  if (width === undefined) return undefined;
  return { bar: { width } };
}

function windowWidgetPatchBuilder(widget: WindowWidgetKey): SettingPatchBuilder {
  return (value) => {
    const patch = windowWidgetPatchForValue(value);
    if (patch === undefined) return undefined;
    return usagePatchForWindowWidget(widget, patch);
  };
}

function resetWidgetPatchBuilder(widget: ResetWidgetKey): SettingPatchBuilder {
  return (value) => {
    const patch = resetWidgetPatchForValue(value);
    if (patch === undefined) return undefined;
    return usagePatchForResetWidget(widget, patch);
  };
}

function windowWidgetPatchForValue(value: string): WindowWidgetConfigPatch | undefined {
  if (!isWindowWidgetValue(value)) return undefined;
  const mode = WINDOW_WIDGET_MODE_BY_VALUE[value];
  return { enabled: mode !== "hidden", mode };
}

function resetWidgetPatchForValue(value: string): ResetWidgetConfigPatch | undefined {
  if (!isResetWidgetValue(value)) return undefined;
  const mode = RESET_WIDGET_MODE_BY_VALUE[value];
  return { enabled: mode !== "hidden", mode };
}

function refreshIntervalPatchForValue(value: string): UsageConfigPatch | undefined {
  const refreshIntervalMs = REFRESH_INTERVAL_BY_VALUE.get(value);
  if (refreshIntervalMs === undefined) return undefined;
  return { refreshIntervalMs };
}

function hideLabelPatchForValue(value: string): UsageConfigPatch | undefined {
  if (!isHideLabelValue(value)) return undefined;
  return { display: { showLabel: value === "No" } };
}

function usagePatchForWindowWidget(
  widget: WindowWidgetKey,
  patch: WindowWidgetConfigPatch,
): UsageConfigPatch {
  const widgets: Partial<Record<WindowWidgetKey, WindowWidgetConfigPatch>> = {};
  widgets[widget] = patch;
  return { widgets };
}

function usagePatchForResetWidget(
  widget: ResetWidgetKey,
  patch: ResetWidgetConfigPatch,
): UsageConfigPatch {
  const widgets: Partial<Record<ResetWidgetKey, ResetWidgetConfigPatch>> = {};
  widgets[widget] = patch;
  return { widgets };
}

function isDisplayValue(value: string): value is DisplayValue {
  return includesString(DISPLAY_VALUES, value);
}

function isWindowWidgetValue(value: string): value is WindowWidgetValue {
  return includesString(WINDOW_WIDGET_VALUES, value);
}

function isResetWidgetValue(value: string): value is ResetWidgetValue {
  return includesString(RESET_WIDGET_VALUES, value);
}

function isHideLabelValue(value: string): value is HideLabelValue {
  return includesString(HIDE_LABEL_VALUES, value);
}

function isColorSchemePreset(value: string): value is ColorSchemePreset {
  return includesString(COLOR_SCHEME_PRESETS, value);
}

function isBarStylePreset(value: string): value is BarStylePreset {
  return includesString(BAR_STYLE_PRESETS, value);
}

function includesString<const T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value as T[number]);
}

function createSettingsListTheme(theme: PiTheme = {}): SettingsListTheme {
  const fg = (color: string, text: string) =>
    typeof theme.fg === "function" ? theme.fg(color, text) : text;

  return {
    label: (text, selected) => (selected ? fg("accent", text) : text),
    value: (text, selected) => (selected ? fg("accent", text) : fg("muted", text)),
    description: (text) => fg("dim", text),
    cursor: fg("accent", "→ "),
    hint: (text) => fg("dim", text),
  };
}

function formatDisplayValue(config: UsageConfig): string {
  if (!config.enabled) return "Off";
  if (config.display.showAlways) return "Always";
  return "On";
}

function formatWindowWidgetValue(widget: WindowWidgetConfig): string {
  if (!widget.enabled || widget.mode === "hidden") return "hidden";
  if (widget.mode === "bar-percent") return "bar + percent";
  return widget.mode;
}

function formatResetWidgetValue(widget: ResetWidgetConfig): string {
  if (!widget.enabled || widget.mode === "hidden") return "hidden";
  return widget.mode;
}

function formatRefreshInterval(refreshIntervalMs: number): string {
  return (
    APPROVED_REFRESH_INTERVAL_PRESETS.find((preset) => preset.value === refreshIntervalMs)?.label ??
    `${refreshIntervalMs}ms`
  );
}

function formatJsonOnlyCustomValue(value: string): string {
  return value === "custom" ? "custom (JSON)" : value;
}
