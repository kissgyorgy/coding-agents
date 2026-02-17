/**
 * Question Tool - Ask the user a question with pre-defined options + free-text input
 *
 * The LLM calls this tool when it needs user input. The user sees a list of
 * options to pick from, plus a "Type something…" option that opens an inline
 * editor for arbitrary text.
 *
 * Based on the upstream pi example: examples/extensions/question.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OptionWithDesc {
	label: string;
	description?: string;
}

type DisplayOption = OptionWithDesc & { isOther?: boolean };

interface QuestionDetails {
	question: string;
	options: string[];
	answer: string | null;
	wasCustom?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Schema (what the LLM sees)                                         */
/* ------------------------------------------------------------------ */

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

const QuestionParams = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	options: Type.Array(OptionSchema, {
		description: "Pre-defined options for the user to choose from. A free-text 'Type something…' option is always appended automatically.",
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
			"Ask the user a question and let them pick from pre-defined options or type a free-form answer. " +
			"Use this whenever you need user input to proceed (e.g. choosing between alternatives, confirming a decision, or requesting clarification).",
		parameters: QuestionParams,

		/* ---- execute ------------------------------------------------- */
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// Non-interactive fallback
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
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
					details: { question: params.question, options: [], answer: null } as QuestionDetails,
				};
			}

			// Build the option list the user sees (originals + free-text entry)
			const allOptions: DisplayOption[] = [
				...params.options,
				{ label: "Type something…", isOther: true },
			];

			/* ---------- custom UI --------------------------------------- */
			const result = await ctx.ui.custom<{ answer: string; wasCustom: boolean; index?: number } | null>(
				(tui, theme, _kb, done) => {
					let optionIndex = 0;
					let editMode = false;
					let cachedLines: string[] | undefined;

					const editorTheme: EditorTheme = {
						borderColor: (s) => theme.fg("accent", s),
						selectList: {
							selectedPrefix: (t) => theme.fg("accent", t),
							selectedText: (t) => theme.fg("accent", t),
							description: (t) => theme.fg("muted", t),
							scrollInfo: (t) => theme.fg("dim", t),
							noMatch: (t) => theme.fg("warning", t),
						},
					};
					const editor = new Editor(tui, editorTheme);

					editor.onSubmit = (value) => {
						const trimmed = value.trim();
						if (trimmed) {
							done({ answer: trimmed, wasCustom: true });
						} else {
							// Empty submit → go back to option list
							editMode = false;
							editor.setText("");
							refresh();
						}
					};

					function refresh() {
						cachedLines = undefined;
						tui.requestRender();
					}

					/* -- input handler -- */
					function handleInput(data: string) {
						if (editMode) {
							if (matchesKey(data, Key.escape)) {
								editMode = false;
								editor.setText("");
								refresh();
								return;
							}
							editor.handleInput(data);
							refresh();
							return;
						}

						if (matchesKey(data, Key.up)) {
							optionIndex = Math.max(0, optionIndex - 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.down)) {
							optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
							refresh();
							return;
						}

						if (matchesKey(data, Key.enter)) {
							const selected = allOptions[optionIndex];
							if (selected.isOther) {
								editMode = true;
								refresh();
							} else {
								done({ answer: selected.label, wasCustom: false, index: optionIndex + 1 });
							}
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

						for (let i = 0; i < allOptions.length; i++) {
							const opt = allOptions[i];
							const selected = i === optionIndex;
							const isOther = opt.isOther === true;
							const prefix = selected ? theme.fg("accent", "> ") : "  ";

							if (isOther && editMode) {
								wrap(prefix + theme.fg("accent", `${i + 1}. ${opt.label} ✎`));
							} else if (selected) {
								wrap(prefix + theme.fg("accent", `${i + 1}. ${opt.label}`));
							} else {
								wrap(`  ${theme.fg("text", `${i + 1}. ${opt.label}`)}`);
							}

							if (opt.description) {
								wrap(`     ${theme.fg("muted", opt.description)}`);
							}
						}

						if (editMode) {
							lines.push("");
							lines.push(theme.fg("muted", " Your answer:"));
							for (const line of editor.render(width - 2)) {
								lines.push(` ${line}`);
							}
						}

						lines.push("");
						if (editMode) {
							lines.push(theme.fg("dim", " Enter to submit • Esc to go back"));
						} else {
							lines.push(theme.fg("dim", " ↑↓ navigate • Enter to select • Esc to cancel"));
						}
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
				},
			);

			/* ---------- build result ---------------------------------- */
			const simpleOptions = params.options.map((o) => o.label);

			if (!result) {
				return {
					content: [{ type: "text", text: "User cancelled the selection." }],
					details: { question: params.question, options: simpleOptions, answer: null } as QuestionDetails,
				};
			}

			if (result.wasCustom) {
				return {
					content: [{ type: "text", text: `User wrote: ${result.answer}` }],
					details: {
						question: params.question,
						options: simpleOptions,
						answer: result.answer,
						wasCustom: true,
					} as QuestionDetails,
				};
			}

			return {
				content: [{ type: "text", text: `User selected: ${result.index}. ${result.answer}` }],
				details: {
					question: params.question,
					options: simpleOptions,
					answer: result.answer,
					wasCustom: false,
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
				return new Text(questionLine + "\n" + theme.fg("warning", "Cancelled"), 0, 0);
			}

			if (details.wasCustom) {
				return new Text(
					questionLine + "\n" +
					theme.fg("success", "✓ ") + theme.fg("muted", "(wrote) ") + theme.fg("accent", details.answer),
					0,
					0,
				);
			}
			const idx = details.options.indexOf(details.answer) + 1;
			const display = idx > 0 ? `${idx}. ${details.answer}` : details.answer;
			return new Text(questionLine + "\n" + theme.fg("success", "✓ ") + theme.fg("accent", display), 0, 0);
		},
	});
}
