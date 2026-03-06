# Build packages (all by default, or specify names: just build claude-code codex)
build *args:
    #!/usr/bin/env bash
    set -euo pipefail
    all="claude-code claude-code-ui gemini-cli ccusage codex crush pi-coding-agent"
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
        [crush]="charmbracelet/crush"
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
        if [[ "$current" == "$latest" ]]; then
            echo "$pkg: already at $current"
            continue
        fi
        nix-update --flake --version "$latest" packages.x86_64-linux."$pkg"
        if git diff --quiet -- packages/"$pkg"*; then
            echo "$pkg: no changes after nix-update"
            continue
        fi
        # For pi-coding-agent, also copy upstream models.generated.ts
        if [[ "$pkg" == "pi-coding-agent" ]]; then
            pkg_dir="packages/pi-coding-agent"
            src=$(nix build .#pi-coding-agent.src --no-link --print-out-paths)
            cp "$src/packages/ai/src/models.generated.ts" "$pkg_dir/models.generated.ts"
            today=$(date +%Y%m%d)
            sed -i "s/modelsDate = \"[0-9]*\"/modelsDate = \"$today\"/" "$pkg_dir/default.nix"
        fi

        git add -- packages/"$pkg"*
        git commit -m "$pkg: $current -> $latest"
    done

# Update pi-coding-agent model definitions from upstream APIs
update-pi-models:
    #!/usr/bin/env bash
    set -euo pipefail
    pkg_dir="packages/pi-coding-agent"
    upstream_version=$(grep 'version = ' "$pkg_dir/default.nix" | head -1 | sed 's/.*"\(.*\)".*/\1/')

    tmpdir=$(mktemp -d)
    trap "rm -rf $tmpdir" EXIT

    echo "Cloning pi-mono v$upstream_version..."
    git clone --depth 1 --branch "v$upstream_version" https://github.com/badlogic/pi-mono.git "$tmpdir/pi-mono"

    echo "Installing dependencies..."
    cd "$tmpdir/pi-mono"
    npm ci --ignore-scripts

    echo "Generating models..."
    npm run --prefix packages/ai generate-models


    cp packages/ai/src/models.generated.ts "$OLDPWD/$pkg_dir/models.generated.ts"
    cd "$OLDPWD"

    today=$(date +%Y%m%d)
    sed -i "s/modelsDate = \"[0-9]*\"/modelsDate = \"$today\"/" "$pkg_dir/default.nix"

    echo "Updated models.generated.ts ($(nix eval --raw .#pi-coding-agent.version))"
