#!/usr/bin/env bash
set -euo pipefail

# Read JSON input and extract all values in a single jq call
IFS=$'\t' read -r model_name current_dir project_dir transcript_path < <(
	jq -r '[
		.model.display_name // "Claude",
		.workspace.current_dir // ".",
		.workspace.project_dir // "",
		.transcript_path // ""
	] | @tsv'
)

# Use cached hostname from environment or get it once
hostname="${HOSTNAME:-${HOST:-$(hostname -s 2>/dev/null || echo localhost)}}"

# Format path with ~ abbreviation (no subshell)
format_path() {
	if [[ "$1" == "$HOME" ]]; then
		echo "~"
	elif [[ "$1" == "$HOME"/* ]]; then
		echo "~${1#$HOME}"
	else
		echo "$1"
	fi
}

# Determine path display
path_display=$(format_path "$current_dir")

# Get session duration using bash built-in SECONDS where possible
duration_str="0s"
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
	file_time=$(stat -c %Y "$transcript_path" 2>/dev/null) || file_time=0
	if [[ $file_time -gt 0 ]]; then
		now=$(printf '%(%s)T' -1)
		duration=$((now - file_time))
		if ((duration < 60)); then
			duration_str="${duration}s"
		elif ((duration < 3600)); then
			duration_str="$((duration / 60))m"
		else
			h=$((duration / 3600))
			m=$(((duration % 3600) / 60))
			((m == 0)) && duration_str="${h}h" || duration_str="${h}h${m}m"
		fi
	fi
fi

# Estimate tokens from transcript size (1 token ≈ 4 chars)
cost_str="0 tokens"
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
	file_size=$(stat -c %s "$transcript_path" 2>/dev/null) || file_size=0
	tokens=$((file_size / 4))
	if ((tokens > 10000)); then
		cost_str="$((tokens / 1000))k tokens"
	else
		cost_str="$tokens tokens"
	fi
fi

printf "%s | %s | %s | %s | %s" "$hostname" "$model_name" "$cost_str" "$duration_str" "$path_display"
