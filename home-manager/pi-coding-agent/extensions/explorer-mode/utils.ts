/**
 * Pure utility functions for explorer mode.
 * Command safety validation and question extraction.
 */

// Commands that are always safe (read-only)
const SAFE_COMMAND_PATTERNS = [
	// File inspection
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*bat\b/,
	// Search
	/^\s*grep\b/,
	/^\s*rg\b/,
	/^\s*ag\b/,
	/^\s*find\b/,
	/^\s*fd\b/,
	/^\s*locate\b/,
	// Directory listing
	/^\s*ls\b/,
	/^\s*exa\b/,
	/^\s*eza\b/,
	/^\s*tree\b/,
	/^\s*pwd\b/,
	// File info
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*wc\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*md5sum\b/,
	/^\s*sha256sum\b/,
	// Text processing (read-only)
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*comm\b/,
	/^\s*cut\b/,
	/^\s*tr\b/,
	/^\s*column\b/,
	/^\s*paste\b/,
	/^\s*fold\b/,
	/^\s*fmt\b/,
	/^\s*nl\b/,
	/^\s*rev\b/,
	/^\s*tac\b/,
	/^\s*expand\b/,
	/^\s*unexpand\b/,
	// General utilities
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*command\s+-v\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	// Process info
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	// Git read-only
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|describe|tag\s*$|blame|shortlog|stash\s+list|ls-files|ls-tree|rev-parse|rev-list|name-rev|cat-file)/i,
	/^\s*git\s+ls-/i,
	// Package managers (read-only queries)
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit|explain|why)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*pnpm\s+(list|ls|why|audit)/i,
	/^\s*pip\s+(list|show|freeze)/i,
	/^\s*cargo\s+(tree|metadata)/i,
	/^\s*go\s+(list|doc|vet|version)/i,
	// Version checks
	/^\s*node\s+--version/i,
	/^\s*python[23]?\s+--version/i,
	/^\s*ruby\s+--version/i,
	/^\s*rustc\s+--version/i,
	/^\s*go\s+version/i,
	/^\s*java\s+--version/i,
	/^\s*java\s+-version/i,
	// JSON/data processing
	/^\s*jq\b/,
	/^\s*yq\b/,
	/^\s*xq\b/,
	// Read-only sed/awk (no -i flag)
	/^\s*sed\s+-n/i,
	/^\s*sed\s+('|")/,
	/^\s*awk\b/,
	/^\s*gawk\b/,
	// Nix read-only
	/^\s*nix\s+(eval|show-derivation|path-info|flake\s+(show|metadata|info)|search|why-depends|store\s+(ls|diff))/i,
	/^\s*nix-instantiate\b/,
	/^\s*nix-store\s+(-q|--query|--print-env)/i,
	// Docker read-only
	/^\s*docker\s+(ps|images|inspect|logs|stats|top|port|version|info|network\s+ls|volume\s+ls)/i,
	/^\s*docker\s+compose\s+(ps|logs|config|images|top)/i,
	// Systemd read-only
	/^\s*systemctl\s+(status|show|list-units|list-unit-files|is-active|is-enabled|cat)/i,
	/^\s*journalctl\b/i,
	// Network read-only
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*ss\b/,
	/^\s*netstat\b/,
	/^\s*ip\s+(addr|route|link|neigh)\s*(show)?/i,
	/^\s*dig\b/,
	/^\s*nslookup\b/,
	/^\s*host\b/,
	/^\s*ping\s/i,
	// Crypto / cert inspection
	/^\s*openssl\s+(x509|s_client|verify)/i,
];

// Patterns that indicate destructive/write operations - always blocked
const DESTRUCTIVE_PATTERNS = [
	// File system writes
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/\binstall\b/i,
	// Redirections (write)
	/(^|[^<])>(?!>)/,
	/>>/,
	// sed in-place
	/\bsed\s+(-i|--in-place)/i,
	// Package managers (install/modify)
	/\bnpm\s+(install|uninstall|update|ci|link|publish|init|create|exec|run)/i,
	/\byarn\s+(add|remove|install|publish|run|create)/i,
	/\bpnpm\s+(add|remove|install|publish|run|create|exec)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bcargo\s+(build|run|install|publish|add|remove)/i,
	/\bgo\s+(build|run|install|generate|get|mod\s+(init|tidy|vendor|download))/i,
	// Git write operations
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|branch\s+-[dDmM]|stash\s+(push|pop|drop|apply|clear)|cherry-pick|revert|tag\s+-[adfs]|init|clone|fetch|am|format-patch|clean)/i,
	// System modification
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable|reload|mask|unmask|daemon-reload)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	// Editors
	/\b(vim?|nano|emacs|code|subl|gedit)\b/i,
	// Nix write operations
	/\bnix\s+(build|develop|run|profile|flake\s+(init|new|update|lock))/i,
	/\bnixos-rebuild\b/i,
	/\bnix-env\b/i,
	/\bnix-build\b/i,
	/\bnix-shell\b/i,
	// Docker write operations
	/\bdocker\s+(run|exec|build|push|pull|rm|rmi|stop|start|restart|kill|create|compose\s+(up|down|start|stop|restart|rm|build|pull|push|exec|run))/i,
	// Compilers / builders (produce output)
	/\bmake\b/i,
	/\bcmake\b/i,
	/\bgcc\b/i,
	/\bg\+\+\b/i,
	/\bclang\b/i,
	/\brustc\b/i,
	/\bjavac\b/i,
	/\btsc\b/i,
	// Terraform / infrastructure
	/\bterraform\s+(apply|destroy|init|import)/i,
	/\bkubectl\s+(apply|create|delete|edit|patch|scale|rollout)/i,
];

/**
 * Check if a bash command is safe (read-only) for explorer mode.
 * A command is safe if it matches a known safe pattern and does NOT match any destructive pattern.
 *
 * For piped commands, every segment must be safe.
 */
export function isSafeCommand(command: string): boolean {
	// Split on pipes and check each segment
	const segments = command.split(/\s*\|\s*/);
	return segments.every((segment) => {
		const trimmed = segment.trim();
		if (!trimmed) return true;

		const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(trimmed));
		if (isDestructive) return false;

		const isSafe = SAFE_COMMAND_PATTERNS.some((p) => p.test(trimmed));
		return isSafe;
	});
}

/**
 * Get a human-readable reason why a command was blocked.
 */
export function getBlockReason(command: string): string {
	const segments = command.split(/\s*\|\s*/);
	for (const segment of segments) {
		const trimmed = segment.trim();
		if (!trimmed) continue;

		const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(trimmed));
		if (isDestructive) {
			return `Destructive command detected in: "${trimmed}"`;
		}

		const isSafe = SAFE_COMMAND_PATTERNS.some((p) => p.test(trimmed));
		if (!isSafe) {
			return `Unknown command not in allowlist: "${trimmed}"`;
		}
	}
	return "Command not recognized as safe";
}
