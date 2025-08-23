#!/usr/bin/env python3
import json
import re
import sys
from typing import Literal, NoReturn


def decision(decision: Literal["deny", "ask"], reason=None) -> dict:
    output = {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
    }
    if reason:
        output["permissionDecisionReason"] = reason
    return {"hookSpecificOutput": output}


VALIDATION_RULES = [
    (
        r"\bgrep\b",
        decision(
            "deny",
            reason="Use 'rg' (ripgrep) instead of 'grep' for better performance and features",
        ),
    ),
    (
        r"\b(find|bfs)\b",
        decision("deny", reason="Use the Search or Glob tool instead of 'find'."),
    ),
    (
        r"\bsudo\b",
        decision("ask"),
    ),
    (
        r"\brm.*--no-preserve-root",
        decision("deny"),
    ),
    (
        r"\brm\s*(-[rRf]+)|(--recursive)|(--force)",
        decision("ask"),
    ),
    (
        r"\balias\b",
        decision("deny", reason="Don't use aliases, use the command directly"),
    ),
]


def validate_command(command: str) -> dict | None:
    for pattern, decision in VALIDATION_RULES:
        if re.search(pattern, command):
            return decision
    else:
        return None


def load_json_input() -> dict | NoReturn:
    try:
        input = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        stop(f"Error: Invalid JSON input for tool call: {e}")

    return input


def get_command(input: dict) -> str | NoReturn:
    tool_name = input.get("tool_name")
    command = input.get("tool_input", {}).get("command")
    if tool_name == "Bash" and command:
        return command

    stop(
        f"""Command validator hook is configured incorrectly.
            Hook Event: {input["hook_event_name"]}
            Tool name: {tool_name}
        """
    )


def stop(reason: str) -> NoReturn:
    output = {"continue": False, "stopReason": reason}
    print_decision(output)
    sys.exit(1)


def print_decision(decision: dict):
    output_json = json.dumps(decision)
    print(output_json)


def main():
    input = load_json_input()
    command = get_command(input)
    if decision := validate_command(command):
        print_decision(decision)


if __name__ == "__main__":
    main()
