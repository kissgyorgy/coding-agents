# Build packages (all by default, or specify names: just build claude-code codex)
build *args:
    #!/usr/bin/env bash
    set -euo pipefail
    all="aichat claude-code claude-code-ui gemini-cli ccusage codex crush hermes-agent pi-coding-agent llmfit llmserve"
    requested="{{args}}"
    attrs=""
    for pkg in ${requested:-$all}; do attrs+=" .#$pkg"; done
    nix build $attrs

# Update all packages sequentially (continues on individual failures)
update:
    #!/usr/bin/env bash
    set -uo pipefail
    failed=()
    for pkg in aichat claude-code codex gemini-cli crush hermes-agent pi-coding-agent llmfit llmserve; do
        echo "==> Updating $pkg"
        if ! just update-"$pkg"; then
            echo "==> FAILED: $pkg"
            failed+=("$pkg")
        fi
    done
    if [[ ${#failed[@]} -gt 0 ]]; then
        echo "\nThe following updates failed: ${failed[*]}"
        exit 1
    fi

update-aichat: (_update-pkg "aichat" "sigoden/aichat")
update-claude-code: (_update-pkg "claude-code" "anthropics/claude-code")
update-codex: (_update-pkg "codex" "openai/codex" "" "true")
update-gemini-cli: (_update-pkg "gemini-cli" "google-gemini/gemini-cli" "" "true")
update-crush: (_update-pkg "crush" "charmbracelet/crush" "" "true")
update-hermes-agent:
    nix flake update hermes-agent
update-llmfit: (_update-pkg "llmfit" "AlexsJones/llmfit")
update-llmserve: (_update-pkg "llmserve" "AlexsJones/llmserve")

update-pi-coding-agent: (_update-pkg "pi-coding-agent" "badlogic/pi-mono" "_pi-post-update") update-pi-models

_pi-post-update:
    #!/usr/bin/env bash
    set -euo pipefail
    pkg_dir="packages/pi-coding-agent"
    src=$(nix build .#pi-coding-agent.src --no-link --print-out-paths)
    cp "$src/packages/ai/src/models.generated.ts" "$pkg_dir/models.generated.ts"
    today=$(date +%Y%m%d)
    sed -i "s/modelsDate = \"[0-9]*\"/modelsDate = \"$today\"/" "$pkg_dir/default.nix"

_update-pkg pkg repo pre_commit="" check_assets="":
    #!/usr/bin/env bash
    set -euo pipefail
    pkg="{{pkg}}"
    repo="{{repo}}"
    tag=$(gh release list --repo "$repo" --exclude-pre-releases --limit 1 --json tagName -q '.[0].tagName')
    latest=${tag#v}
    current=$(nix eval --raw .#"$pkg".version)
    if [[ "$current" == "$latest" ]]; then
        echo "$pkg: already at $current"
        exit 0
    fi
    if [[ -n "{{check_assets}}" ]]; then
        asset_count=$(gh release view "$tag" --repo "$repo" --json assets -q '.assets | length')
        if [[ "$asset_count" == "0" ]]; then
            echo "$pkg: release $tag has no assets, skipping"
            exit 0
        fi
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
    src=$(nix build .#pi-coding-agent.src --no-link --print-out-paths)

    tmpdir=$(mktemp -d)
    trap "rm -rf $tmpdir" EXIT
    cp -r "$src/." "$tmpdir/pi-mono"
    chmod -R u+w "$tmpdir/pi-mono"

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
