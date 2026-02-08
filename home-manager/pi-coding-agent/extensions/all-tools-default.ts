import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function enableAllTools(pi: ExtensionAPI) {
	const allToolNames = pi.getAllTools().map((tool) => tool.name);
	if (allToolNames.length === 0) return;

	const activeToolNames = pi.getActiveTools();
	const alreadyAllEnabled =
		activeToolNames.length === allToolNames.length &&
		allToolNames.every((name) => activeToolNames.includes(name));

	if (!alreadyAllEnabled) {
		pi.setActiveTools(allToolNames);
	}
}

export default function allToolsDefaultExtension(pi: ExtensionAPI) {
	// Initial startup
	pi.on("session_start", async () => {
		enableAllTools(pi);
	});

	// /new and /resume
	pi.on("session_switch", async () => {
		enableAllTools(pi);
	});

	// /fork
	pi.on("session_fork", async () => {
		enableAllTools(pi);
	});
}
