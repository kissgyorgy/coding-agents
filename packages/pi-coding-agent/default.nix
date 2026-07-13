{ lib, buildNpmPackage, callPackage, fetchFromGitHub, nodejs_22, makeBinaryWrapper, autoPatchelfHook ? null, stdenv, libcap_ng }:

let
  modelsDate = "20260713";
  fetchExtensionDeps = callPackage ./fetch-extension-deps.nix { };
in

buildNpmPackage rec {
  pname = "pi-coding-agent-models-${modelsDate}";
  version = "0.80.6";

  src = fetchFromGitHub {
    owner = "earendil-works";
    repo = "pi";
    rev = "v${version}";
    hash = "sha256-e/wcHruEcBAHDF5tKvwew7LXjVp0eraHh2k+QaL2sCA=";
  };

  nodejs = nodejs_22;

  npmDepsFetcherVersion = 2;
  npmDepsHash = "sha256-Y6dIQbmwdR3YqpdMA5ioNf/qUzAwGXjynXhxRrmCRYE=";

  # Skip native addon compilation (canvas etc.) — koffi/clipboard ship pre-built binaries
  npmFlags = [ "--ignore-scripts" ];

  # Native addons (koffi, clipboard) need patching on Linux; tsgo is statically linked
  nativeBuildInputs = [ makeBinaryWrapper ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib libcap_ng ];

  # buildNpmPackage runs npmConfigHook in prePatch, so replace the lockfile
  # immediately after unpacking, before the hook validates and installs deps.
  postUnpack = ''
    cp ${./package-lock.generated.json} $sourceRoot/package-lock.json
  '';

  # Replace upstream models with our freshly generated ones.
  postPatch = ''
    cp ${./models.generated.ts} packages/ai/src/models.generated.ts
  '';

  # Build workspace packages in dependency order: tui -> ai -> agent -> coding-agent
  # Skip generate-models (needs network) — our local models.generated.ts is used instead
  npmBuildScript = "none";
  buildPhase = ''
    runHook preBuild

    for pkg in tui ai agent coding-agent; do
      echo "Building packages/$pkg..."
      npx tsgo -p packages/$pkg/tsconfig.build.json
    done

    # coding-agent post-build: make cli.js executable and copy assets
    chmod +x packages/coding-agent/dist/cli.js

    mkdir -p packages/coding-agent/dist/modes/interactive/theme
    cp packages/coding-agent/src/modes/interactive/theme/*.json \
       packages/coding-agent/dist/modes/interactive/theme/

    mkdir -p packages/coding-agent/dist/modes/interactive/assets
    cp packages/coding-agent/src/modes/interactive/assets/*.png \
       packages/coding-agent/dist/modes/interactive/assets/

    mkdir -p packages/coding-agent/dist/core/export-html/vendor
    cp packages/coding-agent/src/core/export-html/template.html \
       packages/coding-agent/src/core/export-html/template.css \
       packages/coding-agent/src/core/export-html/template.js \
       packages/coding-agent/dist/core/export-html/
    cp packages/coding-agent/src/core/export-html/vendor/*.js \
       packages/coding-agent/dist/core/export-html/vendor/

    runHook postBuild
  '';

  # Install the coding-agent package with its workspace dependencies
  installPhase = ''
    runHook preInstall

    local pkgDir="$out/lib/pi-coding-agent"
    mkdir -p "$pkgDir" "$out/bin"

    # Copy the built coding-agent package
    cp -r packages/coding-agent/dist "$pkgDir/"
    cp packages/coding-agent/package.json "$pkgDir/"
    cp packages/coding-agent/README.md "$pkgDir/"
    cp packages/coding-agent/CHANGELOG.md "$pkgDir/"
    cp -r packages/coding-agent/docs "$pkgDir/"
    cp -r packages/coding-agent/examples "$pkgDir/"

    # Copy node_modules (production deps installed by npmConfigHook)
    cp -r node_modules "$pkgDir/"

    # Workspace packages are symlinked in node_modules — replace with built copies
    for pkg_entry in tui:pi-tui ai:pi-ai agent:pi-agent-core; do
      local dir="''${pkg_entry%%:*}"
      local name="''${pkg_entry##*:}"
      rm -rf "$pkgDir/node_modules/@earendil-works/$name"
      mkdir -p "$pkgDir/node_modules/@earendil-works/$name"
      cp -r "packages/$dir/dist" "$pkgDir/node_modules/@earendil-works/$name/"
      cp "packages/$dir/package.json" "$pkgDir/node_modules/@earendil-works/$name/"
      # Copy root-level compiled files referenced by package.json exports
      cp -f packages/$dir/*.js packages/$dir/*.d.ts "$pkgDir/node_modules/@earendil-works/$name/" 2>/dev/null || true
    done

    # Create the pi wrapper
    makeBinaryWrapper ${nodejs_22}/bin/node $out/bin/pi \
      --add-flags "$pkgDir/dist/cli.js" \
      --set PI_PACKAGE_DIR "$pkgDir" \
      --set PI_TELEMETRY "0" \
      --prefix NODE_PATH : "${fetchExtensionDeps}/node_modules"

    runHook postInstall
  '';

  # Remove native binaries for platforms we don't need.
  # The monorepo node_modules includes deps from all workspace packages (web-ui etc.)
  # with native binaries for platforms we don't need.
  preFixup = ''
    local pkgDir="$out/lib/pi-coding-agent"
  '' + lib.optionalString stdenv.hostPlatform.isLinux ''
    find "$pkgDir/node_modules" -maxdepth 3 -type d -name "*-musl*" -exec rm -rf {} + 2>/dev/null || true
  '' + lib.optionalString (stdenv.hostPlatform.system == "x86_64-linux") ''
    if [ -d "$pkgDir/node_modules/koffi/build/koffi" ]; then
      for dir in "$pkgDir/node_modules/koffi/build/koffi"/*; do
        [ -d "$dir" ] || continue
        [ "$(basename "$dir")" = linux_x64 ] || rm -rf "$dir"
      done
    fi
  '' + lib.optionalString (stdenv.hostPlatform.system == "aarch64-darwin") ''
    if [ -d "$pkgDir/node_modules/koffi/build/koffi" ]; then
      for dir in "$pkgDir/node_modules/koffi/build/koffi"/*; do
        [ -d "$dir" ] || continue
        [ "$(basename "$dir")" = darwin_arm64 ] || rm -rf "$dir"
      done
    fi
  '' + ''
    rm -rf "$pkgDir/node_modules/@biomejs"
    rm -rf "$pkgDir/node_modules/@tailwindcss"

    find "$pkgDir/node_modules" -type l -exec sh -c 'for link do [ -e "$link" ] || rm "$link"; done' sh {} + 2>/dev/null || true
  '';

  meta = {
    description = "Minimal terminal coding harness with AI-powered agent capabilities";
    homepage = "https://github.com/earendil-works/pi/tree/main/packages/coding-agent";
    downloadPage = "https://github.com/earendil-works/pi/releases";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "pi";
    platforms = [ "x86_64-linux" "aarch64-darwin" ];
  };
}
