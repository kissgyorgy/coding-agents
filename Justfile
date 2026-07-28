# Build packages (all by default, or specify names: just build claude-code codex)
build *args:
    #!/usr/bin/env bash
    set -euo pipefail
    all="aichat claude-code claude-code-ui gemini-cli ccusage codex crush hermes-agent pi-coding-agent whichllm llmfit llmserve"
    requested="{{args}}"
    attrs=""
    for pkg in ${requested:-$all}; do
        if [[ "$pkg" == --* ]]; then
            echo "error: '$pkg' is not a package name. Host builds are run from the parent nixconf repo (e.g. cd .. && just build zenix)." >&2
            exit 2
        fi
        attrs+=" .#$pkg"
    done
    nix build $attrs

# Update all packages sequentially (continues on individual failures)
update:
    #!/usr/bin/env bash
    set -uo pipefail
    failed=()
    for pkg in aichat claude-code codex gemini-cli crush hermes-agent pi-coding-agent whichllm llmfit llmserve; do
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
update-claude-code:
    #!/usr/bin/env bash
    set -euo pipefail
    pkg="claude-code"
    repo="anthropics/claude-code"
    tag=$(gh release list --repo "$repo" --exclude-pre-releases --limit 1 --json tagName -q '.[0].tagName')
    latest=${tag#v}
    current=$(nix eval --raw .#"$pkg".version)

    base_url="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/$latest"
    linux_hash=$(nix store prefetch-file --json "$base_url/linux-x64/claude" | jq -r .hash)
    darwin_hash=$(nix store prefetch-file --json "$base_url/darwin-arm64/claude" | jq -r .hash)

    sed -i 's/version = "[^"]*";/version = "'"$latest"'";/' packages/claude-code.nix
    sed -i '/platform = "linux-x64";/,/};/ s|hash = ".*";|hash = "'"$linux_hash"'";|' packages/claude-code.nix
    sed -i '/platform = "darwin-arm64";/,/};/ s|hash = ".*";|hash = "'"$darwin_hash"'";|' packages/claude-code.nix

    if git diff --quiet -- packages/claude-code.nix; then
        echo "$pkg: already at $current with current hashes"
        exit 0
    fi

    if [[ "$current" == "$latest" ]]; then
        message="$pkg: refresh $latest hashes"
    else
        message="$pkg: $current -> $latest"
    fi
    git add -- packages/claude-code.nix
    git commit -m "$message"
update-codex:
    #!/usr/bin/env bash
    set -euo pipefail
    pkg="codex"
    repo="openai/codex"
    pkg_file="packages/codex.nix"
    tag=$(gh release list --repo "$repo" --exclude-pre-releases --limit 1 --json tagName -q '.[0].tagName')
    latest=${tag#v}
    current=$(nix eval --raw .#"$pkg".version)

    asset_count=$(gh release view "$tag" --repo "$repo" --json assets -q '.assets | length')
    if [[ "$asset_count" == "0" ]]; then
        echo "$pkg: release $tag has no assets, skipping"
        exit 0
    fi

    base_url="https://github.com/$repo/releases/download/$tag"
    prefetch() {
        nix store prefetch-file --json "$base_url/$1" | jq -r .hash
    }

    linux_hash=$(prefetch codex-x86_64-unknown-linux-musl.tar.gz)
    linux_code_mode_host_hash=$(prefetch codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz)
    darwin_hash=$(prefetch codex-aarch64-apple-darwin.tar.gz)
    darwin_code_mode_host_hash=$(prefetch codex-code-mode-host-aarch64-apple-darwin.tar.gz)

    sed -i 's/version = "[^"]*";/version = "'"$latest"'";/' "$pkg_file"
    sed -i '/x86_64-linux = {/,/};/ s|hash = ".*";|hash = "'"$linux_hash"'";|' "$pkg_file"
    sed -i '/x86_64-linux = {/,/};/ s|codeModeHostHash = ".*";|codeModeHostHash = "'"$linux_code_mode_host_hash"'";|' "$pkg_file"
    sed -i '/aarch64-darwin = {/,/};/ s|hash = ".*";|hash = "'"$darwin_hash"'";|' "$pkg_file"
    sed -i '/aarch64-darwin = {/,/};/ s|codeModeHostHash = ".*";|codeModeHostHash = "'"$darwin_code_mode_host_hash"'";|' "$pkg_file"

    if git diff --quiet -- "$pkg_file"; then
        echo "$pkg: already at $current with current hashes"
        exit 0
    fi

    if [[ "$current" == "$latest" ]]; then
        message="$pkg: refresh $latest hashes"
    else
        message="$pkg: $current -> $latest"
    fi
    git add -- "$pkg_file"
    git commit -m "$message"
update-gemini-cli: (_update-pkg "gemini-cli" "google-gemini/gemini-cli" "" "true")
update-crush:
    #!/usr/bin/env bash
    set -euo pipefail
    pkg="crush"
    repo="charmbracelet/crush"
    pkg_file="packages/crush.nix"
    tag=$(gh release list --repo "$repo" --exclude-pre-releases --limit 1 --json tagName -q '.[0].tagName')
    latest=${tag#v}
    current=$(nix eval --raw .#"$pkg".version)

    asset_count=$(gh release view "$tag" --repo "$repo" --json assets -q '.assets | length')
    if [[ "$asset_count" == "0" ]]; then
        echo "$pkg: release $tag has no assets, skipping"
        exit 0
    fi

    base_url="https://github.com/$repo/releases/download/$tag"
    linux_hash=$(nix store prefetch-file --json "$base_url/crush_${latest}_Linux_x86_64.tar.gz" | jq -r .hash)
    darwin_hash=$(nix store prefetch-file --json "$base_url/crush_${latest}_Darwin_arm64.tar.gz" | jq -r .hash)

    sed -i 's/version = "[^"]*";/version = "'"$latest"'";/' "$pkg_file"
    sed -i '/x86_64-linux = {/,/};/ s|hash = ".*";|hash = "'"$linux_hash"'";|' "$pkg_file"
    sed -i '/aarch64-darwin = {/,/};/ s|hash = ".*";|hash = "'"$darwin_hash"'";|' "$pkg_file"

    if git diff --quiet -- "$pkg_file"; then
        echo "$pkg: already at $current with current hashes"
        exit 0
    fi

    if [[ "$current" == "$latest" ]]; then
        message="$pkg: refresh $latest hashes"
    else
        message="$pkg: $current -> $latest"
    fi
    git add -- "$pkg_file"
    git commit -m "$message"
update-hermes-agent:
    nix flake update hermes-agent
update-whichllm: (_update-pkg "whichllm" "Andyyyy64/whichllm")
update-llmfit: (_update-pkg "llmfit" "AlexsJones/llmfit")
update-llmserve: (_update-pkg "llmserve" "AlexsJones/llmserve")

update-pi-coding-agent: (_update-pkg "pi-coding-agent" "earendil-works/pi" "_pi-post-update")

# Regenerate Pi's model catalog locally and install it in the user model store
update-pi-models:
    #!/usr/bin/env bash
    set -euo pipefail
    pi_source=$(nix build .#pi-coding-agent.src --no-link --print-out-paths)
    pi_package=$(nix build .#pi-coding-agent --no-link --print-out-paths)
    node scripts/update-pi-models.mjs "$pi_source" "$pi_package"

_pi-post-update:
    #!/usr/bin/env bash
    set -euo pipefail
    pkg_dir="packages/pi-coding-agent"
    pkg_file="$pkg_dir/default.nix"
    version=$(nix eval --raw .#pi-coding-agent.version)
    pi_ai_url="https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-${version}.tgz"
    pi_ai_hash=$(nix store prefetch-file --json "$pi_ai_url" | jq -r .hash)
    sed -i '/piAiNpm = fetchurl {/,/};/ s|hash = ".*";|hash = "'"$pi_ai_hash"'";|' "$pkg_file"

    src=$(nix build .#pi-coding-agent.src --no-link --print-out-paths)
    cp "$src/package-lock.json" "$pkg_dir/package-lock.generated.json"

    sed -i 's/npmDepsHash = "sha256-[^"]*";/npmDepsHash = lib.fakeHash;/' "$pkg_file"
    set +e
    build_output=$(nix build .#pi-coding-agent 2>&1)
    build_status=$?
    set -e
    if [[ $build_status -eq 0 ]]; then
        echo "pi-coding-agent: expected fake npmDepsHash to fail, but build succeeded" >&2
        exit 1
    fi
    npm_deps_hash=$(awk '/got:[[:space:]]*sha256-/ { print $2; exit }' <<<"$build_output")
    if [[ -z "$npm_deps_hash" ]]; then
        echo "$build_output" >&2
        echo "pi-coding-agent: failed to extract npmDepsHash from nix build output" >&2
        exit 1
    fi
    sed -i 's|npmDepsHash = lib\.fakeHash;|npmDepsHash = "'"$npm_deps_hash"'";|' "$pkg_file"

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
