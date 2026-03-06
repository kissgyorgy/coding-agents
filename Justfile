# Build packages (all by default, or specify names: just build claude-code codex)
build *args:
    #!/usr/bin/env bash
    set -euo pipefail
    all="claude-code claude-code-ui gemini-cli ccusage codex crush pi-coding-agent"
    attrs=""
    for pkg in ${args:-$all}; do attrs+=" .#$pkg"; done
    nix build $attrs

# Update all packages in parallel
update:
    #!/usr/bin/env bash
    set -euo pipefail
    pids=()
    for task in update-claude-code update-codex update-gemini-cli update-crush update-pi-coding-agent; do
        just $task &
        pids+=($!)
    done
    failed=0
    for pid in "${pids[@]}"; do wait $pid || ((failed++)); done
    exit $failed

update-claude-code: (_update-pkg "claude-code" "anthropics/claude-code")
update-codex: (_update-pkg "codex" "openai/codex")
update-gemini-cli: (_update-pkg "gemini-cli" "google-gemini/gemini-cli")
update-crush: (_update-pkg "crush" "charmbracelet/crush")

update-pi-coding-agent: (_update-pkg "pi-coding-agent" "badlogic/pi-mono" "_pi-post-update") update-pi-models

_pi-post-update:
    #!/usr/bin/env bash
    set -euo pipefail
    pkg_dir="packages/pi-coding-agent"
    src=$(nix build .#pi-coding-agent.src --no-link --print-out-paths)
    cp "$src/packages/ai/src/models.generated.ts" "$pkg_dir/models.generated.ts"
    today=$(date +%Y%m%d)
    sed -i "s/modelsDate = \"[0-9]*\"/modelsDate = \"$today\"/" "$pkg_dir/default.nix"

_update-pkg pkg repo pre_commit="":
    #!/usr/bin/env bash
    set -euo pipefail
    pkg="{{pkg}}"
    repo="{{repo}}"
    latest=$(gh release list --repo "$repo" --exclude-pre-releases --limit 1 --json tagName -q '.[0].tagName' | sed 's/^v//')
    current=$(nix eval --raw .#"$pkg".version)
    if [[ "$current" == "$latest" ]]; then
        echo "$pkg: already at $current"
        exit 0
    fi
    nix-update --flake --version "$latest" packages.x86_64-linux."$pkg"
    if git diff --quiet -- packages/"$pkg"*; then
        echo "$pkg: no changes after nix-update"
        exit 0
    fi
    if [[ -n "{{pre_commit}}" ]]; then
        just {{pre_commit}}
    fi
    git add -- packages/"$pkg"*
    git commit -m "$pkg: $current -> $latest"

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

    if ! git diff --quiet -- "$pkg_dir"; then
        git add -- "$pkg_dir"
        git commit -m "pi-coding-agent: update generated models"
    fi
    echo "Updated models.generated.ts ($(nix eval --raw .#pi-coding-agent.version))"
