import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { complete, getModel } from "@mariozechner/pi-ai";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import { CustomEditor, DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text, matchesKey } from "@mariozechner/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, parsePlanSections, type TodoItem } from "./utils.js";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

interface ModelRef {
	provider: string;
	id: string;
}

interface PlanModeSettings {
	slugModel?: ModelRef;
	executionModel?: ModelRef;
}

const SETTINGS_PATH = join(homedir(), ".pi", "agent", "plan-mode.json");

function loadSettings(): PlanModeSettings {
	try {
		if (existsSync(SETTINGS_PATH)) {
			return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
		}
	} catch {
		/* ignore */
	}
	return {};
}

function saveSettings(settings: PlanModeSettings): void {
	const dir = join(homedir(), ".pi", "agent");
	mkdirSync(dir, { recursive: true });
	writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let planFilePath: string | null = null;
	let planFullText: string | null = null;
	let settings: PlanModeSettings = {};
	let preExecutionModel: { provider: string; id: string } | null = null;

	const PLAN_TEMPLATE = `# Overview


# Implementation plan


# Files to modify


# Todo items
1. 
`;

	function localDateSlug(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	}

	async function writePlanFile(items: TodoItem[], fullText: string | null, cwd: string, ctx: ExtensionContext): Promise<string> {
		const plansDir = join(cwd, "plans");
		mkdirSync(plansDir, { recursive: true });
		const date = localDateSlug();
		const todoList = items.map((t) => `${t.step}. ${t.text}`).join("\n");

		// Parse sections from fullText if it already has structured headers (avoids duplicating them)
		const parsed = fullText ? parsePlanSections(fullText) : null;
		const implementationText = parsed?.implementation ?? fullText;

		let slug = "";
		let overview = "";
		try {
			const slugProvider = settings.slugModel?.provider ?? "anthropic";
			const slugModelId = settings.slugModel?.id ?? "claude-haiku-4-5";
			const model = ctx.modelRegistry.find(slugProvider, slugModelId)
				?? getModel("anthropic", "claude-haiku-4-5");
			const apiKey = model ? await ctx.modelRegistry.getApiKey(model) : undefined;
			if (model && apiKey) {
				const response = await complete(
					model,
					{
						messages: [{
							role: "user" as const,
							content: [{ type: "text" as const, text: `Given this plan, provide two things separated by "---":
1. A 1-2 sentence overview summary of what this plan accomplishes
2. A short 2-4 word kebab-case slug for the filename

Example response:
Add a Ctrl+G keyboard shortcut to the plan mode extension that opens the plan file in an external editor.
---
plan-editor-shortcut

Plan:
${implementationText || todoList}` }],
							timestamp: Date.now(),
						}],
					},
					{ apiKey, maxTokens: 200, signal: AbortSignal.timeout(5_000) },
				);
				const raw = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("")
					.trim();
				const parts = raw.split("---");
				if (parts.length >= 2) {
					overview = parts[0].trim();
					slug = parts[1]
						.trim()
						.toLowerCase()
						.replace(/[^a-z0-9-]/g, "")
						.slice(0, 40);
				} else {
					slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
				}
			}
		} catch { /* fall back to date-only */ }

		// Prefer overview extracted from structured text over Haiku-generated one
		if (parsed?.overview) overview = parsed.overview;

		const filename = slug ? `plan-${date}-${slug}.md` : `plan-${date}.md`;
		const filePath = join(plansDir, filename);

		const files = parsed?.files || (implementationText ? extractFileReferences(implementationText) : "");

		const content = `# Overview
${overview ? `\n${overview}\n` : "\n"}
# Implementation plan
${implementationText ? `\n${implementationText}\n` : "\n"}
# Files to modify
${files ? `\n${files}\n` : "\n"}
# Todo items
${todoList}
`;
		writeFileSync(filePath, content);
		return filePath;
	}

	function extractFileReferences(text: string): string {
		const filePattern = /(?:^|\s)([`"']?(?:[\w./~-]+\/)+[\w.-]+[`"']?)/gm;
		const seen = new Set<string>();
		const files: string[] = [];
		for (const match of text.matchAll(filePattern)) {
			const file = match[1].replace(/^[`"']+|[`"']+$/g, "");
			if (!seen.has(file) && file.includes("/") && !file.startsWith("http") && !file.startsWith("//")) {
				seen.add(file);
				files.push(`- ${file}`);
			}
		}
		return files.join("\n");
	}

	/** Rewrite an existing plan file in-place with updated content (no slug generation). */
	function updatePlanFileInPlace(filePath: string, items: TodoItem[], fullText: string | null): void {
		const todoList = items.map((t) => `${t.step}. ${t.text}`).join("\n");

		// Parse sections from fullText if it already has structured headers (avoids duplicating them)
		const parsed = fullText ? parsePlanSections(fullText) : null;
		const implementationText = parsed?.implementation ?? fullText;
		const files = parsed?.files || (implementationText ? extractFileReferences(implementationText) : "");

		// Prefer parsed overview, then fall back to existing file overview
		let overview = parsed?.overview || "";
		if (!overview) {
			try {
				const existing = readFileSync(filePath, "utf-8");
				const overviewMatch = existing.match(/^# Overview\n\n([\s\S]*?)\n\n# Implementation plan/m);
				if (overviewMatch) {
					overview = overviewMatch[1].trim();
				}
			} catch { /* ignore */ }
		}

		const content = `# Overview
${overview ? `\n${overview}\n` : "\n"}
# Implementation plan
${implementationText ? `\n${implementationText}\n` : "\n"}
# Files to modify
${files ? `\n${files}\n` : "\n"}
# Todo items
${todoList}
`;
		writeFileSync(filePath, content);
	}

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan") + ctx.ui.theme.fg("dim", " (ctrl+g)"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget (above editor)
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];
		// Preserve planFilePath and planFullText so the plan file reference
		// survives toggling off/on (avoids creating duplicate files).

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
			ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
		} else {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
		persistState();
	}

	async function startExecution(ctx: ExtensionContext): Promise<void> {
		planModeEnabled = false;
		executionMode = true;
		if (!planFilePath) {
			planFilePath = await writePlanFile(todoItems, planFullText, ctx.cwd, ctx);
		}
		pi.setActiveTools(NORMAL_MODE_TOOLS);

		// Switch to execution model if configured
		if (settings.executionModel) {
			// Save current model for restoration
			if (ctx.model) {
				preExecutionModel = { provider: ctx.model.provider, id: ctx.model.id };
			}
			const execModel = ctx.modelRegistry.find(
				settings.executionModel.provider,
				settings.executionModel.id,
			);
			if (execModel) {
				const success = await pi.setModel(execModel);
				if (!success) {
					ctx.ui.notify(
						`Plan execution model ${settings.executionModel.provider}/${settings.executionModel.id}: no API key`,
						"warning",
					);
				}
			} else {
				ctx.ui.notify(
					`Plan execution model ${settings.executionModel.provider}/${settings.executionModel.id} not found`,
					"warning",
				);
			}
		}

		updateStatus(ctx);
		persistState();

		let fileContents = "";
		if (planFilePath) {
			try {
				fileContents = readFileSync(planFilePath, "utf-8");
			} catch { /* ignore */ }
		}

		const todoList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
		pi.sendMessage(
			{
				customType: "plan-mode-execute",
				content: `Execute this plan step by step. After completing each step, include a [DONE:n] tag in your response (e.g. [DONE:1], [DONE:2]).

Plan file (${planFilePath}):
${fileContents}

Todo list:
${todoList}

Start with step 1.`,
				display: true,
			},
			{ triggerTurn: true },
		);
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			planFile: planFilePath,
		});
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("plan:execute", {
		description: "Execute the current plan (exit plan mode and start tracked execution)",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No plan to execute. Create a plan first with /plan", "warning");
				return;
			}
			if (executionMode) {
				ctx.ui.notify("Already executing a plan", "warning");
				return;
			}
			await startExecution(ctx);
		},
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerCommand("plan:edit", {
		description: "Edit the current plan file",
		handler: async (_args, ctx) => {
			const isNew = !planFilePath || !existsSync(planFilePath);
			const currentContent = isNew ? PLAN_TEMPLATE : readFileSync(planFilePath, "utf-8");

			const edited = await ctx.ui.editor("Edit plan:", currentContent);
			if (edited == null || edited === currentContent) return;
			if (isNew && edited === PLAN_TEMPLATE) return;

			if (isNew) {
				await createNewPlanFile(edited, ctx);
			} else {
				savePlanEdit(edited, ctx);
			}
		},
	});

	pi.registerCommand("plan:model", {
		description: "Configure models for plan slug generation and execution",
		handler: async (_args, ctx) => {
			// First: pick which setting to change
			const setting = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const slugCurrent = settings.slugModel
					? `${settings.slugModel.provider}/${settings.slugModel.id}`
					: "anthropic/claude-haiku-4-5 (default)";
				const execCurrent = settings.executionModel
					? `${settings.executionModel.provider}/${settings.executionModel.id}`
					: "(keep current model)";

				const items: SelectItem[] = [
					{ value: "slug", label: "Slug/Overview model", description: slugCurrent },
					{ value: "execution", label: "Execution model", description: execCurrent },
				];

				const container = new Container();
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
				container.addChild(new Text(theme.fg("accent", theme.bold(" Plan Mode Models")), 0, 0));

				const selectList = new SelectList(items, 4, {
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				});
				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);
				container.addChild(selectList);
				container.addChild(new Text(theme.fg("dim", " ↑↓ navigate • enter select • esc cancel")));
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			});

			if (!setting) return;

			// Second: pick model
			const available = await ctx.modelRegistry.getAvailable();
			const modelItems: SelectItem[] = available.map((m) => ({
				value: `${m.provider}/${m.id}`,
				label: `${m.provider}/${m.id}`,
				description: m.name ?? "",
			}));

			if (setting === "execution") {
				modelItems.unshift({
					value: "(keep-current)",
					label: "(keep current model)",
					description: "Don't switch model when executing",
				});
			}

			const modelChoice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const title = setting === "slug" ? "Slug/Overview Model" : "Execution Model";
				const container = new Container();
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
				container.addChild(new Text(theme.fg("accent", theme.bold(` ${title}`)), 0, 0));

				const selectList = new SelectList(modelItems, Math.min(modelItems.length, 15), {
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				});
				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);
				container.addChild(selectList);
				container.addChild(new Text(theme.fg("dim", " ↑↓ navigate • enter select • type to filter • esc cancel")));
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			});

			if (!modelChoice) return;

			if (setting === "slug") {
				const [provider, ...idParts] = modelChoice.split("/");
				settings.slugModel = { provider, id: idParts.join("/") };
				saveSettings(settings);
				ctx.ui.notify(`Plan slug model: ${modelChoice}`, "info");
			} else {
				if (modelChoice === "(keep-current)") {
					delete settings.executionModel;
					saveSettings(settings);
					ctx.ui.notify("Execution model: keep current", "info");
				} else {
					const [provider, ...idParts] = modelChoice.split("/");
					settings.executionModel = { provider, id: idParts.join("/") };
					saveSettings(settings);
					ctx.ui.notify(`Execution model: ${modelChoice}`, "info");
				}
			}
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	pi.registerShortcut(Key.ctrlAlt("e"), {
		description: "Execute the current plan",
		handler: async (ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No plan to execute. Create a plan first with /plan", "warning");
				return;
			}
			if (executionMode) {
				ctx.ui.notify("Already executing a plan", "warning");
				return;
			}
			await startExecution(ctx);
		},
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// In execution mode, start with a clean context from the execute message onward.
	// Otherwise, filter out plan mode context injections.
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		if (executionMode) {
			const startIdx = event.messages.findIndex((m) => {
				const msg = m as AgentMessage & { customType?: string };
				return msg.customType === "plan-mode-execute";
			});
			return { messages: startIdx >= 0 ? event.messages.slice(startIdx) : [] };
		}

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.customType === "plan-execution-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan mode instructions before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: read, bash, grep, find, ls, questionnaire
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Structure your response with these sections:

# Overview
A short 1-2 sentence summary of the plan.

# Implementation plan
Detailed analysis and approach.

# Files to modify
List each file with a short explanation and code examples where helpful.

# Todo items
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		// Inject remaining steps on each agent run during execution to keep it going
		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track [DONE:n] progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and post-plan interactive picker
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				// Restore pre-execution model
				if (preExecutionModel) {
					const prevModel = ctx.modelRegistry.find(preExecutionModel.provider, preExecutionModel.id);
					if (prevModel) await pi.setModel(prevModel);
					preExecutionModel = null;
				}

				executionMode = false;
				todoItems = [];
				planFilePath = null;
				planFullText = null;
				pi.setActiveTools(NORMAL_MODE_TOOLS);
				updateStatus(ctx);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const text = getTextContent(lastAssistant);
			const extracted = extractTodoItems(text);
			if (extracted.length > 0) {
				todoItems = extracted;
				planFullText = text;
			}
		}

		// Write plan file to disk.
		// If a plan file already exists on disk, update it in-place (preserve slug/path).
		// Only create a brand new file (with Haiku slug) when no file exists yet.
		if (todoItems.length > 0) {
			if (planFilePath && existsSync(planFilePath)) {
				updatePlanFileInPlace(planFilePath, todoItems, planFullText);
			} else {
				planFilePath = await writePlanFile(todoItems, planFullText, ctx.cwd, ctx);
			}
		}

		// Show plan steps (user can press Tab to see /plan:* commands)
		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}
	});

	// Shared helper: save edited plan content back to file, re-parse todos
	function savePlanEdit(edited: string, ctx: ExtensionContext): void {
		if (!planFilePath) return;
		writeFileSync(planFilePath, edited);

		const oldCompleted = new Set(
			todoItems.filter((t) => t.completed).map((t) => t.text),
		);
		const newItems = extractTodoItems(edited);
		if (newItems.length > 0) {
			for (const item of newItems) {
				if (oldCompleted.has(item.text)) item.completed = true;
			}
			todoItems = newItems;
			planFullText = edited;
		}
		updateStatus(ctx);
		persistState();
		ctx.ui.notify(`Plan updated (${planFilePath})`, "info");
	}

	// Async helper for creating a new plan file from edited content
	// (used by PlanEditor and /plan:edit when no file exists yet)
	async function createNewPlanFile(edited: string, ctx: ExtensionContext): Promise<void> {
		const newItems = extractTodoItems(edited);
		if (newItems.length > 0) {
			todoItems = newItems;
			planFullText = edited;
		}
		planFilePath = await writePlanFile(
			newItems.length > 0 ? newItems : [{ step: 1, text: "Define plan steps", completed: false }],
			edited,
			ctx.cwd,
			ctx,
		);
		updateStatus(ctx);
		persistState();
		ctx.ui.notify(`Plan created (${planFilePath})`, "info");
	}

	// Custom editor that intercepts Ctrl+G to edit the plan file in $EDITOR.
	// When plan/execution mode is active, Ctrl+G opens the plan file (or a
	// template for new plans) in $VISUAL/$EDITOR. On save, the content is
	// written back and todo items are re-parsed.
	let editorCtx: ExtensionContext | null = null;

	class PlanEditor extends CustomEditor {
		handleInput(data: string): void {
			// Tab on empty editor in plan mode: show /plan:* command completions
			if (
				matchesKey(data, Key.tab) &&
				planModeEnabled &&
				!this.isShowingAutocomplete() &&
				this.getText().trim() === ""
			) {
				// Type "/plan:" char by char so "/" triggers autocomplete
				// and subsequent chars progressively filter to plan:* commands
				this.setText("");
				for (const ch of "/plan:") {
					super.handleInput(ch);
				}
				return;
			}

			if (
				matchesKey(data, Key.ctrl("g")) &&
				(planModeEnabled || executionMode) &&
				editorCtx
			) {
				// Determine content: existing plan file or template for new plan
				const isNew = !planFilePath || !existsSync(planFilePath);
				const planContent = isNew ? PLAN_TEMPLATE : readFileSync(planFilePath, "utf-8");

				// Save current prompt text so we can restore it after
				const originalText = editorCtx.ui.getEditorText();

				editorCtx.ui.setEditorText(planContent);

				// Delegate to built-in externalEditor (synchronous: spawnSync)
				super.handleInput(data);

				const edited = editorCtx.ui.getEditorText();

				// Restore the user's original prompt
				editorCtx.ui.setEditorText(originalText);

				// Save if changed (skip if unchanged or still the unmodified template)
				if (edited != null && edited !== planContent && !(isNew && edited === PLAN_TEMPLATE)) {
					if (isNew) {
						// Fire-and-forget: create new plan file asynchronously (slug via Haiku)
						void createNewPlanFile(edited, editorCtx);
					} else {
						savePlanEdit(edited, editorCtx);
					}
				}
				return;
			}
			super.handleInput(data);
		}
	}

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		settings = loadSettings();

		// Register plan-aware editor for Ctrl+G interception
		editorCtx = ctx;
		ctx.ui.setEditorComponent((tui, theme, kb) => new PlanEditor(tui, theme, kb));

		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean } } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			planFilePath = (planModeEntry.data as { planFile?: string }).planFile ?? planFilePath;
		}

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			// Find the index of the last plan-mode-execute entry (marks when current execution started)
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			// Safety: if executionMode is stuck but the execute marker is
			// missing (e.g. after compaction), auto-clear to avoid an empty
			// context that makes the LLM loop or error.
			if (executeIndex === -1) {
				executionMode = false;
				planModeEnabled = false;
				todoItems = [];
				planFilePath = null;
				planFullText = null;
				persistState();
				ctx.ui.notify("Plan execution state was stale — auto-cleared. Use /plan to start fresh.", "warning");
			} else {
				// Only scan messages after the execute marker
				const messages: AssistantMessage[] = [];
				for (let i = executeIndex + 1; i < entries.length; i++) {
					const entry = entries[i];
					if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
						messages.push(entry.message as AssistantMessage);
					}
				}
				const allText = messages.map(getTextContent).join("\n");
				markCompletedSteps(allText, todoItems);
			}
		}

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}
