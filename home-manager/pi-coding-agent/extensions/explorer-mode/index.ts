/**
 * Explorer Mode Extension
 *
 * A read-only codebase exploration mode that helps users discover and
 * understand a codebase by asking questions. The agent cannot write or
 * edit files, and bash commands are restricted to a safe allowlist.
 *
 * Features:
 * - /explore command or Ctrl+Alt+E to toggle
 * - --explore flag to start in explorer mode
 * - Only read-only tools available (read, grep, find, ls)
 * - Bash restricted to allowlisted read-only commands (no write/edit/delete)
 * - Write and edit tools completely disabled
 * - question tool available for asking the user clarifying questions
 * - System prompt guides the agent to be a helpful codebase guide
 * - Status indicator in footer
 * - Session-persistent state
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { isSafeCommand, getBlockReason } from "./utils.js";

// Tools available in explorer mode: read-only + question for interaction
const EXPLORER_TOOLS = ["read", "bash", "grep", "find", "ls", "question"];

const EXPLORER_SYSTEM_PROMPT = `[EXPLORER MODE — READ-ONLY]

You are a codebase explorer helping the user understand this project. Your goal
is to answer questions, explain architecture, trace code paths, and help the
user build a mental model of the codebase.

**Constraints (enforced by the system — do not attempt to bypass):**
- You CANNOT use edit or write tools — they are disabled
- Bash commands are restricted to a read-only allowlist
- You must NOT suggest the user exit explorer mode to make changes
- Focus entirely on reading, understanding, and explaining

**How to help:**
- When asked about a feature, trace through the code from entry point to implementation
- Explain design patterns and architectural decisions you observe
- Summarize directory structures and module responsibilities
- Find relevant code with grep/find, then read and explain it
- Point out connections between modules, data flow, and dependencies
- When you need clarification about what the user wants to understand, use the question tool

**Style guidelines:**
- Be concise but thorough — explain "why" not just "what"
- Use code references (file:line) so the user can follow along
- When showing code, quote the relevant snippet rather than the entire file
- Proactively mention related code the user might want to explore next
- If a question is ambiguous, ask the user to clarify with the question tool`;

export default function explorerModeExtension(pi: ExtensionAPI): void {
	let explorerEnabled = false;
	let savedTools: string[] | null = null;

	// --explore CLI flag
	pi.registerFlag("explore", {
		description: "Start in explorer mode (read-only codebase exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		if (explorerEnabled) {
			ctx.ui.setStatus(
				"explorer-mode",
				ctx.ui.theme.fg("accent", "🔍 explore"),
			);
		} else {
			ctx.ui.setStatus("explorer-mode", undefined);
		}
	}

	function enableExplorer(ctx: ExtensionContext): void {
		explorerEnabled = true;
		savedTools = pi.getActiveTools();
		pi.setActiveTools(EXPLORER_TOOLS);
		updateStatus(ctx);
		persistState();
		ctx.ui.notify("Explorer mode enabled — read-only codebase exploration", "info");
	}

	function disableExplorer(ctx: ExtensionContext): void {
		explorerEnabled = false;
		if (savedTools) {
			pi.setActiveTools(savedTools);
			savedTools = null;
		}
		updateStatus(ctx);
		persistState();
		ctx.ui.notify("Explorer mode disabled — full tool access restored", "info");
	}

	function toggleExplorer(ctx: ExtensionContext): void {
		if (explorerEnabled) {
			disableExplorer(ctx);
		} else {
			enableExplorer(ctx);
		}
	}

	function persistState(): void {
		pi.appendEntry("explorer-mode", {
			enabled: explorerEnabled,
			savedTools,
		});
	}

	// /explore command
	pi.registerCommand("explore", {
		description: "Toggle explorer mode (read-only codebase exploration)",
		handler: async (_args, ctx) => toggleExplorer(ctx),
	});

	// Ctrl+Alt+E shortcut
	pi.registerShortcut(Key.ctrlAlt("e"), {
		description: "Toggle explorer mode",
		handler: async (ctx) => toggleExplorer(ctx),
	});

	// Block write and edit tools entirely in explorer mode
	pi.on("tool_call", async (event, ctx) => {
		if (!explorerEnabled) return;

		// Block write and edit tools
		if (event.toolName === "write" || event.toolName === "edit") {
			return {
				block: true,
				reason: `Explorer mode: ${event.toolName} is disabled. This is a read-only exploration session. Use /explore to exit explorer mode if you need to make changes.`,
			};
		}

		// Restrict bash to safe commands
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				const reason = getBlockReason(command);
				return {
					block: true,
					reason: `Explorer mode: bash command blocked. ${reason}. Only read-only commands are allowed. Use /explore to exit explorer mode if you need to run this command.`,
				};
			}
		}
	});

	// Inject explorer guidance into system prompt each turn
	pi.on("before_agent_start", async (event) => {
		if (!explorerEnabled) return;

		return {
			systemPrompt: event.systemPrompt + "\n\n" + EXPLORER_SYSTEM_PROMPT,
		};
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		// Check --explore flag
		if (pi.getFlag("explore") === true) {
			explorerEnabled = true;
		}

		// Restore persisted state from session branch
		const branchEntries = ctx.sessionManager.getBranch();
		for (const entry of branchEntries) {
			if (
				entry.type === "custom" &&
				entry.customType === "explorer-mode"
			) {
				const data = entry.data as {
					enabled?: boolean;
					savedTools?: string[] | null;
				} | undefined;
				if (data) {
					explorerEnabled = data.enabled ?? explorerEnabled;
					savedTools = data.savedTools ?? savedTools;
				}
			}
		}

		if (explorerEnabled) {
			pi.setActiveTools(EXPLORER_TOOLS);
		}
		updateStatus(ctx);
	});

	// Restore on tree navigation
	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	// Restore after fork
	pi.on("session_fork", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	function restoreFromBranch(ctx: ExtensionContext): void {
		const branchEntries = ctx.sessionManager.getBranch();
		let restoredEnabled = false;
		let restoredSavedTools: string[] | null = null;

		for (const entry of branchEntries) {
			if (
				entry.type === "custom" &&
				entry.customType === "explorer-mode"
			) {
				const data = entry.data as {
					enabled?: boolean;
					savedTools?: string[] | null;
				} | undefined;
				if (data) {
					restoredEnabled = data.enabled ?? false;
					restoredSavedTools = data.savedTools ?? null;
				}
			}
		}

		explorerEnabled = restoredEnabled;
		savedTools = restoredSavedTools;

		if (explorerEnabled) {
			pi.setActiveTools(EXPLORER_TOOLS);
		}
		updateStatus(ctx);
	}
}
