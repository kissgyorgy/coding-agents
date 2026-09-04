/**
 * Question Tool - Ask the user a question with pre-defined options
 *
 * The LLM calls this tool when it needs user input. The user can select one of
 * the options, or press Escape to dismiss the picker and answer in the normal
 * editor.
 *
 * Based on the upstream pi example: examples/extensions/question.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  Text,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface QuestionDetails {
  question: string;
  options: string[];
  answer: string | null;
}

/* ------------------------------------------------------------------ */
/*  Schema (what the LLM sees)                                         */
/* ------------------------------------------------------------------ */

const OptionSchema = Type.Object({
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
});

const QuestionParams = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  options: Type.Array(OptionSchema, {
    description: "Pre-defined options for the user to choose from.",
  }),
});

/* ------------------------------------------------------------------ */
/*  Extension entry point                                              */
/* ------------------------------------------------------------------ */

export default function question(pi: ExtensionAPI) {
  pi.registerTool({
    name: "question",
    label: "Question",
    description:
      "Ask the user a question and let them pick from pre-defined options. " +
      "The user can press Escape to dismiss the picker and answer in a normal message. " +
      "Use this whenever you need user input to proceed (e.g. choosing between alternatives, confirming a decision, or requesting clarification).",
    parameters: QuestionParams,
    executionMode: "sequential",

    /* ---- execute ------------------------------------------------- */
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Custom components are only available in TUI mode.
      if (ctx.mode !== "tui") {
        return {
          content: [
            {
              type: "text",
              text: "Error: UI not available (running in non-interactive mode)",
            },
          ],
          details: {
            question: params.question,
            options: params.options.map((o) => o.label),
            answer: null,
          } as QuestionDetails,
        };
      }

      if (params.options.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No options provided" }],
          details: {
            question: params.question,
            options: [],
            answer: null,
          } as QuestionDetails,
        };
      }

      /* ---------- custom UI --------------------------------------- */
      let result: { answer: string; index: number } | null;
      ctx.ui.setWorkingVisible(false);
      try {
        result = await ctx.ui.custom<{
          answer: string;
          index: number;
        } | null>((tui, theme, _kb, done) => {
          let optionIndex = 0;
          let cachedLines: string[] | undefined;

          function refresh() {
            cachedLines = undefined;
            tui.requestRender();
          }

          /* -- input handler -- */
          function handleInput(data: string) {
            if (matchesKey(data, Key.up)) {
              optionIndex = Math.max(0, optionIndex - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              optionIndex = Math.min(
                params.options.length - 1,
                optionIndex + 1,
              );
              refresh();
              return;
            }

            if (matchesKey(data, Key.enter)) {
              done({
                answer: params.options[optionIndex].label,
                index: optionIndex + 1,
              });
              return;
            }

            if (matchesKey(data, Key.escape)) {
              done(null);
            }
          }

          /* -- render -- */
          function render(width: number): string[] {
            if (cachedLines) return cachedLines;

            const lines: string[] = [];
            const wrap = (s: string) => {
              for (const wl of wrapTextWithAnsi(s, width)) {
                lines.push(wl);
              }
            };

            lines.push(theme.fg("accent", "─".repeat(width)));
            for (const wl of wrapTextWithAnsi(` ${params.question}`, width)) {
              lines.push(theme.fg("text", wl));
            }
            lines.push("");

            for (let i = 0; i < params.options.length; i++) {
              const opt = params.options[i];
              const selected = i === optionIndex;
              const prefix = selected ? theme.fg("accent", "> ") : "  ";

              if (selected) {
                wrap(prefix + theme.fg("accent", `${i + 1}. ${opt.label}`));
              } else {
                wrap(`  ${theme.fg("text", `${i + 1}. ${opt.label}`)}`);
              }

              if (opt.description) {
                wrap(`     ${theme.fg("muted", opt.description)}`);
              }
            }

            lines.push("");
            lines.push(
              theme.fg(
                "dim",
                " ↑↓ navigate • Enter to select • Esc to answer normally",
              ),
            );
            lines.push(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            return lines;
          }

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
          };
        });
      } finally {
        ctx.ui.setWorkingVisible(true);
      }

      /* ---------- build result ---------------------------------- */
      const simpleOptions = params.options.map((o) => o.label);

      if (!result) {
        return {
          content: [],
          details: {
            question: params.question,
            options: simpleOptions,
            answer: null,
          } as QuestionDetails,
          terminate: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `User selected: ${result.index}. ${result.answer}`,
          },
        ],
        details: {
          question: params.question,
          options: simpleOptions,
          answer: result.answer,
        } as QuestionDetails,
      };
    },

    /* ---- renderCall ---------------------------------------------- */
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("question")), 0, 0);
    },

    /* ---- renderResult -------------------------------------------- */
    renderResult(result, _options, theme) {
      const details = result.details as QuestionDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      const questionLine = theme.fg("muted", details.question);

      if (details.answer === null) {
        return new Text(questionLine, 0, 0);
      }
      const idx = details.options.indexOf(details.answer) + 1;
      const display = idx > 0 ? `${idx}. ${details.answer}` : details.answer;
      return new Text(
        questionLine +
          "\n" +
          theme.fg("success", "✓ ") +
          theme.fg("accent", display),
        0,
        0,
      );
    },
  });
}
