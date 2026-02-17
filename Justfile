# Build packages (all by default, or specify names: just build claude-code codex)
build *args:
    #!/usr/bin/env bash
    set -euo pipefail
    all="claude-code claude-code-ui gemini-cli ccusage codex pi-coding-agent"
    attrs=""
    for pkg in ${args:-$all}; do attrs+=" .#$pkg"; done
    nix build $attrs

# Update coding agent packages
update:
    #!/usr/bin/env bash
    set -euo pipefail
    declare -A repos=(
        [claude-code]="anthropics/claude-code"
        [codex]="openai/codex"
        [gemini-cli]="google-gemini/gemini-cli"
        [pi-coding-agent]="badlogic/pi-mono"
    )
    tmpdir=$(mktemp -d)
    trap "rm -rf $tmpdir" EXIT
    for pkg in "${!repos[@]}"; do
        (
            latest=$(gh release list --repo "${repos[$pkg]}" --exclude-pre-releases --limit 1 --json tagName -q '.[0].tagName' | sed 's/^v//')
            echo "$latest" > "$tmpdir/$pkg"
        ) &
    done
    wait
    for pkg in "${!repos[@]}"; do
        latest=$(cat "$tmpdir/$pkg")
        current=$(nix eval --raw .#"$pkg".version)
        if [[ "$latest" == "$current" ]]; then
            echo "$pkg: already at $current"
            continue
        fi
        nix-update --flake --version "$latest" packages.x86_64-linux."$pkg"
        git add "packages/$pkg.nix"
        git commit -m "$pkg: $current -> $latest"
    done
