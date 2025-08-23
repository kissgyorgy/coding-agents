#!/usr/bin/env bash
set -euo pipefail

# Debug mode (uncomment to enable logging)
# DEBUG_STATUSLINE=1

# Read JSON input from stdin
input=$(cat)

# Debug logging function
debug_log() {
    if [ "${DEBUG_STATUSLINE:-0}" = "1" ]; then
        echo "[DEBUG] $1" >>/tmp/claude-statusline-debug.log
    fi
}

# Check if jq is available
if ! command -v jq >/dev/null 2>&1; then
    echo "zenix | Sonnet 4 | No cost data | nixconf"
    exit 0
fi

# Check if input is valid JSON
if ! echo "$input" | jq . >/dev/null 2>&1; then
    echo "zenix | Sonnet 4 | No cost data | nixconf"
    exit 0
fi

# Extract basic information
model_name=$(echo "$input" | jq -r '.model.display_name // "Claude"')
current_dir=$(echo "$input" | jq -r '.workspace.current_dir // "."')
project_dir=$(echo "$input" | jq -r '.workspace.project_dir // ""')
output_style=$(echo "$input" | jq -r '.output_style.name // "default"')
hostname=$(hostname -s 2>/dev/null || echo "localhost")

# Function to format path like shell prompt (with ~ abbreviation)
format_path_like_shell() {
    local path="$1"
    local home="$HOME"

    # Replace home directory with ~
    if [[ "$path" == "$home" ]]; then
        echo "~"
    elif [[ "$path" == "$home"/* ]]; then
        echo "~${path#$home}"
    else
        echo "$path"
    fi
}

# Determine path display (format like shell prompt)
if [ "$current_dir" != "$project_dir" ] && [ -n "$project_dir" ]; then
    rel_path=$(realpath --relative-to="$project_dir" "$current_dir" 2>/dev/null || echo "$current_dir")
    if [ "$rel_path" != "." ]; then
        path_display=$(format_path_like_shell "$project_dir/$rel_path")
    else
        path_display=$(format_path_like_shell "$project_dir")
    fi
else
    path_display=$(format_path_like_shell "$current_dir")
fi

# Extract model information for cost calculation
model_id=$(echo "$input" | jq -r '.model.id // ""')
session_id=$(echo "$input" | jq -r '.session_id // ""')
transcript_path=$(echo "$input" | jq -r '.transcript_path // ""')

# Debug logging
debug_log "model_id: '$model_id', session_id: '$session_id'"

# Function to get cost information
get_cost_info() {
    local cost_info=""

    # Try to get token usage from transcript if available
    if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
        # Count approximate tokens from transcript size (rough estimate: 1 token ≈ 4 chars)
        local file_size=$(wc -c <"$transcript_path" 2>/dev/null || echo "0")
        local estimated_tokens=$((file_size / 4))

        if [ "$estimated_tokens" -gt 10000 ]; then
            local tokens_in_k=$((estimated_tokens / 1000))
            cost_info="${tokens_in_k}k tokens"
        elif [ "$estimated_tokens" -gt 0 ]; then
            cost_info="${estimated_tokens} tokens"
        else
            cost_info="0 tokens"
        fi
    else
        # Fallback: show session-based info
        if [ -n "$session_id" ]; then
            cost_info="Active session"
        else
            cost_info="New session"
        fi
    fi

    echo "$cost_info"
}

# Get cost information
cost_indicator=$(get_cost_info)

# Debug logging for final cost info
debug_log "Final cost_indicator: '$cost_indicator'"

# Output the status line with cost information
printf "%s | %s | %s | %s" "$hostname" "$model_name" "$cost_indicator" "$path_display"
