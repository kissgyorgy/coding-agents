import type {
  BarConfig,
  ColorConfig,
  UsageConfig,
  ResetWidgetConfig,
  WindowWidgetConfig,
} from "./config";
import {
  colorizeProgressBarSegments,
  colorizeUsageText,
  resolveUsageColor,
  type UsageColorTheme,
} from "./color";
import { renderProgressBarSegments, type ProgressBarSegment } from "./progress-bar";
import type { UsageSnapshot } from "./usage-snapshot";

const LOGIN_REQUIRED_STATUS_TEXT = "Usage login required";
const AUTH_FAILED_STATUS_TEXT = "Usage auth failed";
const REFRESH_FAILED_STATUS_TEXT = "Usage refresh failed";
const REFRESH_WARNING_TEXT = "refresh failed";
const VISIBLE_LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]+/gu;

export type FormatUsageStatusLineOptions = {
  snapshot: UsageSnapshot | undefined;
  config: UsageConfig;
  now?: Date;
  locale?: string | string[];
  timeZone?: string;
  theme?: UsageColorTheme;
};

type FormattedWidget = {
  text: string;
};

/**
 * Formats a Usage Snapshot into one status-line string.
 *
 * The formatter returns text only; Pi UI APIs are owned by the status controller.
 * Undefined means the controller should clear the status entry.
 */
export function formatUsageStatusLine(
  options: FormatUsageStatusLineOptions,
): string | undefined {
  if (options.snapshot === undefined) return undefined;

  const widgets = formatUsageWidgets(options);
  if (widgets.length === 0) return undefined;

  return toSingleVisibleLine(composeStatusLine(options.config, widgets, options.theme));
}

export function formatUsageLoginRequiredStatusLine(theme?: UsageColorTheme): string {
  return toSingleVisibleLine(formatNeutralText(LOGIN_REQUIRED_STATUS_TEXT, theme));
}

export function formatUsageAuthFailedStatusLine(theme?: UsageColorTheme): string {
  return toSingleVisibleLine(formatNeutralText(AUTH_FAILED_STATUS_TEXT, theme));
}

export function formatUsageRefreshFailedStatusLine(theme?: UsageColorTheme): string {
  return toSingleVisibleLine(formatNeutralText(REFRESH_FAILED_STATUS_TEXT, theme));
}

export function appendUsageRefreshFailureMarker(
  statusText: string,
  theme?: UsageColorTheme,
): string {
  const markerText = theme?.fg("warning", REFRESH_WARNING_TEXT) ?? REFRESH_WARNING_TEXT;
  return `${statusText}${formatNeutralText(" (", theme)}${markerText}${formatNeutralText(")", theme)}`;
}

function formatUsageWidgets(options: FormatUsageStatusLineOptions): FormattedWidget[] {
  const { config, snapshot } = options;
  if (snapshot === undefined) return [];

  return [
    formatWindowWidget(snapshot.fiveHourLeftPercent, config.widgets.fiveHour, options),
    formatWindowWidget(snapshot.sevenDayLeftPercent, config.widgets.sevenDay, options),
    formatResetWidget(snapshot.fiveHourResetInSeconds, config.widgets.fiveHourReset, options),
    formatResetWidget(snapshot.sevenDayResetInSeconds, config.widgets.sevenDayReset, options),
  ].filter((widget): widget is FormattedWidget => widget !== undefined);
}

function composeStatusLine(
  config: UsageConfig,
  widgets: readonly FormattedWidget[],
  theme?: UsageColorTheme,
): string {
  const body = widgets.map((widget) => widget.text).join(formatNeutralText(config.display.separator, theme));
  const label = formatStatusLabel(config);
  return label === undefined ? body : `${formatNeutralText(`${label}: `, theme)}${body}`;
}

function formatStatusLabel(config: UsageConfig): string | undefined {
  if (!config.display.showLabel) return undefined;

  const label = config.display.label.trim();
  return label.length > 0 ? label : undefined;
}

function formatWindowWidget(
  percent: number | null,
  config: WindowWidgetConfig,
  options: FormatUsageStatusLineOptions,
): FormattedWidget | undefined {
  if (!isWidgetVisible(config) || !isFiniteNumber(percent)) return undefined;

  return {
    text: formatWindowWidgetText(percent, config, options),
  };
}

function formatWindowWidgetText(
  percent: number | null,
  config: WindowWidgetConfig,
  options: FormatUsageStatusLineOptions,
): string {
  const barConfig = options.config.bar;
  const colorContext = {
    colors: options.config.colors,
    theme: options.theme,
    isLimited: options.snapshot?.isLimited,
  };

  switch (config.mode) {
    case "percent":
      return formatColorableWindowWidget({
        labelPrefix: `${config.label}: `,
        percentText: formatPercent(percent),
        percent,
        context: colorContext,
      });
    case "bar": {
      const barSegments = renderProgressBarSegments(percent, barConfig);
      return formatColorableWindowWidget({
        labelPrefix: `${config.label} `,
        barSegments,
        percent,
        context: colorContext,
      });
    }
    case "bar-percent": {
      const barSegments = renderProgressBarSegments(percent, barConfig);
      return formatColorableWindowWidget({
        labelPrefix: `${config.label} `,
        barSegments,
        percentText: formatPercent(percent),
        percent,
        context: colorContext,
      });
    }
    case "hidden":
      return config.label;
  }
}

type WindowColorContext = {
  colors: ColorConfig;
  theme?: UsageColorTheme;
  isLimited?: boolean;
};

type ColorableWindowWidgetParts = {
  labelPrefix: string;
  barSegments?: readonly ProgressBarSegment[];
  percentText?: string;
  percent: number | null;
  context: WindowColorContext;
};

function formatColorableWindowWidget(parts: ColorableWindowWidgetParts): string {
  const barText = formatBarText(parts.barSegments);
  const valueText = joinWindowValueParts(barText, parts.percentText);
  const uncoloredText = `${parts.labelPrefix}${valueText}`;
  const neutralLabelPrefix = formatNeutralText(parts.labelPrefix, parts.context.theme);
  const neutralBarText = formatNeutralText(barText, parts.context.theme);
  const usesGradient = usesLayeredBarGradient(parts.context.colors, parts.barSegments);

  switch (parts.context.colors.target) {
    case "widget":
      if (!usesGradient) return colorizeWindowText(uncoloredText, parts);
      return `${colorizeWindowText(parts.labelPrefix, parts)}${formatColorableBar(parts)}${formatColorablePercentWithPrefix(
        parts,
        true,
      )}`;
    case "value":
      return `${neutralLabelPrefix}${formatColorableValue(parts)}`;
    case "bar":
      return `${neutralLabelPrefix}${formatColorableBar(parts)}${formatColorablePercentWithPrefix(parts, false)}`;
    case "percent":
      return `${neutralLabelPrefix}${neutralBarText}${formatColorablePercentWithPrefix(parts, true)}`;
    case "none":
      return formatNeutralText(uncoloredText, parts.context.theme);
  }
}

function formatColorableValue(parts: ColorableWindowWidgetParts): string {
  if (parts.barSegments === undefined) return colorizeWindowText(parts.percentText ?? "", parts);
  return `${formatColorableBar(parts)}${formatColorablePercentWithPrefix(parts, false)}`;
}

function formatColorableBar(parts: ColorableWindowWidgetParts): string {
  if (parts.barSegments === undefined) return "";

  if (usesLayeredBarGradient(parts.context.colors, parts.barSegments)) {
    return colorizeProgressBarSegments({
      segments: parts.barSegments,
      percent: parts.percent,
      colors: parts.context.colors,
      theme: parts.context.theme,
      isLimited: parts.context.isLimited,
      formatNeutralSegment: (text) => formatNeutralText(text, parts.context.theme),
    });
  }

  return colorizeWindowText(formatBarText(parts.barSegments), parts);
}

function formatColorablePercentWithPrefix(
  parts: ColorableWindowWidgetParts,
  shouldColor: boolean,
): string {
  if (parts.percentText === undefined) return "";
  const separator = parts.barSegments === undefined ? "" : " ";
  const percentText = shouldColor
    ? colorizeWindowText(parts.percentText, parts)
    : formatNeutralText(parts.percentText, parts.context.theme);
  return `${formatNeutralText(separator, parts.context.theme)}${percentText}`;
}

function colorizeWindowText(text: string, parts: ColorableWindowWidgetParts): string {
  const color = resolveUsageColor({
    percent: parts.percent,
    colors: parts.context.colors,
    theme: parts.context.theme,
    isLimited: parts.context.isLimited,
  });
  if (color === undefined) return formatNeutralText(text, parts.context.theme);

  return colorizeUsageText({
    text,
    percent: parts.percent,
    colors: parts.context.colors,
    theme: parts.context.theme,
    isLimited: parts.context.isLimited,
  });
}

function formatNeutralText(text: string, theme?: UsageColorTheme): string {
  if (theme === undefined || text.length === 0) return text;
  return theme.fg("dim", text);
}

function formatBarText(segments: readonly ProgressBarSegment[] | undefined): string {
  if (segments === undefined) return "";
  return segments.map((segment) => segment.text).join("");
}

function joinWindowValueParts(barText: string, percentText: string | undefined): string {
  if (barText.length === 0) return percentText ?? "";
  if (percentText === undefined) return barText;
  return `${barText} ${percentText}`;
}

function usesLayeredBarGradient(
  colors: ColorConfig,
  barSegments: readonly ProgressBarSegment[] | undefined,
): boolean {
  return (
    barSegments !== undefined &&
    colors.barGradient.enabled &&
    colors.scheme !== "none" &&
    colors.target !== "none" &&
    colors.target !== "percent"
  );
}

function formatResetWidget(
  seconds: number | null,
  config: ResetWidgetConfig,
  options: FormatUsageStatusLineOptions,
): FormattedWidget | undefined {
  if (!isWidgetVisible(config) || !isFiniteNumber(seconds)) return undefined;

  return {
    text: formatNeutralText(`${config.label} ${formatResetValue(seconds, config.mode, options)}`, options.theme),
  };
}

function isWidgetVisible(config: WindowWidgetConfig | ResetWidgetConfig): boolean {
  return config.enabled && config.mode !== "hidden";
}

function formatPercent(percent: number | null): string {
  if (!isFiniteNumber(percent)) return "--";
  return `${Math.round(clamp(percent, 0, 100))}%`;
}

function formatResetValue(
  seconds: number | null,
  mode: ResetWidgetConfig["mode"],
  options: FormatUsageStatusLineOptions,
): string {
  if (!isFiniteNumber(seconds)) return "--";

  switch (mode) {
    case "countdown":
      return formatResetCountdown(seconds);
    case "clock":
      return formatResetClock(seconds, options);
    case "both":
      return `${formatResetCountdown(seconds)} - ${formatResetClock(seconds, options)}`;
    case "hidden":
      return "--";
  }
}

export function formatResetCountdown(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${remainingSeconds}s`;
}

function formatResetClock(seconds: number, options: FormatUsageStatusLineOptions): string {
  const now = options.now ?? new Date();
  const resetAt = new Date(now.getTime() + Math.max(0, seconds) * 1000);
  return new Intl.DateTimeFormat(options.locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: options.timeZone,
  }).format(resetAt);
}

function toSingleVisibleLine(text: string): string {
  return text.replace(VISIBLE_LINE_BREAK_PATTERN, " ").trim();
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
