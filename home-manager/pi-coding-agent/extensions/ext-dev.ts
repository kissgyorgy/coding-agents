/**
 * Extension Development Helper
 *
 * Registers a `/ext` command that:
 * 1. Reads all relevant pi extension development documentation
 * 2. Autocompletes `@extdir` for extensions in getAgentDir()/extensions/
 * 3. Injects docs + extension source into context for the LLM
 *
 * Usage:
 *   /ext                  — Load docs, ask what to work on
 *   /ext plan-mode        — Load docs + source of the plan-mode extension
 *   /ext my-ext do X      — Load docs + source, with a specific instruction
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * List extension entries (dirs and .ts files) in the extensions/ folder.
 */
function listExtensions(agentDir: string): string[] {
	const extensionsDir = path.join(agentDir, "extensions");
	if (!fs.existsSync(extensionsDir)) return [];

	const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
	const results: string[] = [];

	for (const entry of entries) {
		if (entry.isDirectory()) {
			results.push(entry.name);
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			results.push(entry.name.replace(/\.ts$/, ""));
		}
	}

	return results.sort();
}

/**
 * Read all .ts files from an extension (single file or directory).
 */
function readExtensionSource(agentDir: string, name: string): { files: { path: string; content: string }[]; basePath: string } | null {
	const extensionsDir = path.join(agentDir, "extensions");
	const dirPath = path.join(extensionsDir, name);
	const filePath = path.join(extensionsDir, `${name}.ts`);

	if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
		const files = collectFiles(dirPath, "");
		return { files, basePath: dirPath };
	} else if (fs.existsSync(filePath)) {
		return {
			files: [{ path: `${name}.ts`, content: fs.readFileSync(filePath, "utf-8") }],
			basePath: extensionsDir,
		};
	}

	return null;
}

/**
 * Recursively collect all files in a directory.
 */
function collectFiles(dir: string, prefix: string): { path: string; content: string }[] {
	const results: { path: string; content: string }[] = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		const full = path.join(dir, entry.name);

		if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
			results.push(...collectFiles(full, rel));
		} else if (entry.isFile() && !entry.name.endsWith(".lock")) {
			try {
				results.push({ path: rel, content: fs.readFileSync(full, "utf-8") });
			} catch {
				// skip binary / unreadable files
			}
		}
	}

	return results;
}

/**
 * Resolve the pi package's docs and examples directories via PI_PACKAGE_DIR
 * (set by the pi launcher script).
 */
function getPiPaths(): { docsDir: string | null; examplesDir: string | null } {
	const pkgDir = process.env.PI_PACKAGE_DIR;
	if (!pkgDir) return { docsDir: null, examplesDir: null };

	const docsDir = path.join(pkgDir, "docs");
	const examplesDir = path.join(pkgDir, "examples", "extensions");

	return {
		docsDir: fs.existsSync(docsDir) ? docsDir : null,
		examplesDir: fs.existsSync(examplesDir) ? examplesDir : null,
	};
}

/**
 * Read documentation files, returning their content.
 */
function readDocs(docsDir: string, files: string[]): string {
	let content = "";

	for (const file of files) {
		const filePath = path.join(docsDir, file);
		if (fs.existsSync(filePath)) {
			content += `\n\n${"=".repeat(60)}\n# ${file}\n${"=".repeat(60)}\n\n`;
			content += fs.readFileSync(filePath, "utf-8");
		}
	}

	return content;
}

export default function (pi: ExtensionAPI) {
	const agentDir = getAgentDir();

	pi.registerCommand("ext", {
		description: "Load extension development docs and optionally target an extension with @name",

		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const extNames = listExtensions(agentDir);
			const items: AutocompleteItem[] = extNames.map((name) => ({
				value: name,
				label: name,
				description: fs.existsSync(path.join(agentDir, "extensions", name))
					? fs.statSync(path.join(agentDir, "extensions", name)).isDirectory()
						? "directory"
						: "file"
					: "file",
			}));

			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},

		handler: async (args, ctx) => {
			const { docsDir, examplesDir } = getPiPaths();

			// --- Read documentation ---
			let docsContent = "";
			if (docsDir) {
				docsContent = readDocs(docsDir, ["extensions.md", "tui.md", "keybindings.md", "themes.md"]);
			} else {
				ctx.ui.notify("Could not locate pi documentation directory", "warning");
			}

			// --- Read examples README as a reference ---
			let examplesRef = "";
			if (examplesDir) {
				const readmePath = path.join(examplesDir, "README.md");
				if (fs.existsSync(readmePath)) {
					examplesRef += `\n\n${"=".repeat(60)}\n# Extension Examples Reference\n${"=".repeat(60)}\n\n`;
					examplesRef += fs.readFileSync(readmePath, "utf-8");
					examplesRef += `\n\nExamples directory: ${examplesDir}\nUse the read tool to inspect specific examples as needed.\n`;
				}
			}

			// --- Parse extension name from args (first word) ---
			const parts = args.trim().split(/\s+/);
			const extNames = listExtensions(agentDir);
			const extName = parts.length > 0 && extNames.includes(parts[0]) ? parts[0] : null;
			const freeText = extName ? parts.slice(1).join(" ").trim() : args.trim();

			// --- Read extension source if specified ---
			let extSource = "";
			if (extName) {
				const ext = readExtensionSource(agentDir, extName);
				if (ext) {
					extSource += `\n\n${"=".repeat(60)}\n# Extension Source: ${extName}\n${"=".repeat(60)}\n`;
					extSource += `\nBase path: ${ext.basePath}\n`;
					for (const file of ext.files) {
						extSource += `\n--- ${file.path} ---\n\n${file.content}\n`;
					}
				} else {
					ctx.ui.notify(`Extension "${extName}" not found in ${path.join(agentDir, "extensions")}`, "error");
					return;
				}
			}

			// --- Inject docs as a hidden context message ---
			const docsContext =
				"# Pi Extension Development Documentation\n\n" +
				"Below is the complete documentation for developing pi extensions, " +
				"including the extension API, TUI components, keybindings, and theming.\n" +
				docsContent +
				examplesRef;

			pi.sendMessage(
				{
					customType: "ext-dev-docs",
					content: docsContext,
					display: false,
				},
				{ triggerTurn: false, deliverAs: "nextTurn" },
			);

			// --- Inject extension source as a separate hidden context message ---
			if (extName && extSource) {
				pi.sendMessage(
					{
						customType: "ext-dev-source",
						content: extSource,
						display: false,
					},
					{ triggerTurn: false, deliverAs: "nextTurn" },
				);
			}

			// --- Send a simple user message to kick off the turn ---
			let prompt: string;
			if (extName) {
				prompt = freeText || `Help me work on the "${extName}" extension.`;
			} else {
				prompt = freeText || "What extension would you like to create or work on?";
			}

			pi.sendUserMessage(prompt);
		},
	});
}
