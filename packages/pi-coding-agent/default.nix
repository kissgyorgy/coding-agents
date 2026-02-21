{ lib, buildNpmPackage, fetchFromGitHub, nodejs_22, makeBinaryWrapper, autoPatchelfHook, stdenv }:

let
  upstreamVersion = "0.54.0";
  modelsDate = "20260221";
in

buildNpmPackage rec {
  pname = "pi-coding-agent";
  version = "${upstreamVersion}-models-${modelsDate}";

  src = fetchFromGitHub {
    owner = "badlogic";
    repo = "pi-mono";
    rev = "v${upstreamVersion}";
    hash = "sha256-j8h8KKt/1m47Y6/KA8g213gooq0n2fAqBVkKhHsBCGw=";
  };

  nodejs = nodejs_22;

  npmDepsHash = "sha256-L2kP2VpRNg+YeZjvXyn+Soly2wlff4jpZ5qa3T43quE=";

  # Skip native addon compilation (canvas etc.) — koffi/clipboard ship pre-built binaries
  npmFlags = [ "--ignore-scripts" ];

  # Native addons (koffi, clipboard) need patching; tsgo is statically linked
  nativeBuildInputs = [ autoPatchelfHook makeBinaryWrapper ];
  buildInputs = [ stdenv.cc.cc.lib ];

  # Replace upstream models with our freshly generated ones
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
      rm -rf "$pkgDir/node_modules/@mariozechner/$name"
      mkdir -p "$pkgDir/node_modules/@mariozechner/$name"
      cp -r "packages/$dir/dist" "$pkgDir/node_modules/@mariozechner/$name/"
      cp "packages/$dir/package.json" "$pkgDir/node_modules/@mariozechner/$name/"
    done

    # Create the pi wrapper
    makeBinaryWrapper ${nodejs_22}/bin/node $out/bin/pi \
      --add-flags "$pkgDir/dist/cli.js" \
      --set PI_PACKAGE_DIR "$pkgDir"

    runHook postInstall
  '';

  # Remove non-Linux-x64-glibc native binaries before autoPatchelf tries them.
  # The monorepo node_modules includes deps from all workspace packages (web-ui etc.)
  # with native binaries for platforms we don't need.
  preFixup = ''
    local pkgDir="$out/lib/pi-coding-agent"

    # Remove all musl packages (we use glibc)
    find "$pkgDir/node_modules" -maxdepth 3 -type d -name "*-musl*" -exec rm -rf {} + 2>/dev/null || true

    # Remove koffi builds for other platforms (keep only linux_x64)
    find "$pkgDir/node_modules/koffi/build/koffi" -mindepth 1 -maxdepth 1 -type d \
      ! -name linux_x64 -exec rm -rf {} + 2>/dev/null || true

    # Remove dev-only tools not needed at runtime (biome, tailwindcss, etc.)
    rm -rf "$pkgDir/node_modules/@biomejs"
    rm -rf "$pkgDir/node_modules/@tailwindcss"

    # Remove all broken symlinks (workspace links to packages/ that aren't in output,
    # .bin links to removed packages, etc.)
    find "$pkgDir/node_modules" -xtype l -delete 2>/dev/null || true
  '';

  meta = {
    description = "Minimal terminal coding harness with AI-powered agent capabilities";
    homepage = "https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent";
    downloadPage = "https://github.com/badlogic/pi-mono/releases";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "pi";
    platforms = [ "x86_64-linux" ];
  };
}
