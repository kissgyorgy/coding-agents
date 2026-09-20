#!/usr/bin/env bash
set -euo pipefail

cache="${CACHIX_CACHE:-coding-agents}"
packages=(
	aichat
	claude-code
	claude-code-ui
	gemini-cli
	ccusage
	codex
	pi-coding-agent
)
failed=()

for package in "${packages[@]}"; do
	echo "::group::Building $package"
	if nix build ".#$package" --print-build-logs; then
		cachix push "$cache" ./result*
	else
		echo "::warning::Failed to build $package, skipping"
		failed+=("$package")
	fi
	echo "::endgroup::"
done

if [[ ${#failed[@]} -gt 0 ]]; then
	echo "::warning::Failed to build: ${failed[*]}"
	if [[ "${ALLOW_FAILURES:-0}" != "1" ]]; then
		exit 1
	fi
fi
