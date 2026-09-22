{ lib, buildNpmPackage, callPackage, fetchNpmDeps, nodejs_22, makeBinaryWrapper, autoPatchelfHook ? null, stdenv, libxcb }:

let
  version = "0.87.1";
  fetchExtensionDeps = callPackage ./fetch-extension-deps.nix { };
in

buildNpmPackage rec {
  pname = "pi-coding-agent";
  inherit version;

  src = ./.;

  nodejs = nodejs_22;

  npmDepsFetcherVersion = 2;
  npmDepsHash = "sha256-gr2HG3LZcdofRAYq1dsk5EHasnMefV10YJG0N5P8l3U=";
  npmDeps = fetchNpmDeps {
    src = ./.;
    hash = npmDepsHash;
    fetcherVersion = npmDepsFetcherVersion;
  };

  # Use an installer-style root package and lockfile containing the exact
  # production dependency closure for this Pi release.
  # Pi's published packages contain the release-built bundle, generated model
  # catalogs, documentation, assets, and native TUI helpers. Lifecycle scripts
  # are neither needed nor safe in the sandbox for a release installation.
  npmFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;

  nativeBuildInputs = [ makeBinaryWrapper ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ libxcb ];

  installPhase = ''
    runHook preInstall

    local pkgDir="$out/lib/pi-coding-agent"
    mkdir -p "$out/lib" "$out/bin"

    # Keep Pi's conventional package layout while retaining npm's hoisted,
    # lockfile-complete runtime dependency tree beside the package itself.
    mv node_modules/@earendil-works/pi-coding-agent "$pkgDir"
    cp -r node_modules "$pkgDir/"
    rm "$pkgDir/node_modules/.bin/pi"

    makeBinaryWrapper ${nodejs_22}/bin/node "$out/bin/pi" \
      --add-flags "$pkgDir/dist/bundle/cli.js" \
      --set PI_PACKAGE_DIR "$pkgDir" \
      --set PI_TELEMETRY "0" \
      --prefix NODE_PATH : "${fetchExtensionDeps}/node_modules"

    runHook postInstall
  '';

  # The TUI package ships prebuilt helpers for every supported OS and CPU.
  # Retain only the target helper so autoPatchelf processes the correct binary.
  preFixup = ''
    local nativeDir="$out/lib/pi-coding-agent/node_modules/@earendil-works/pi-tui/native"
  '' + lib.optionalString (stdenv.hostPlatform.system == "x86_64-linux") ''
    rm -rf "$nativeDir/darwin" "$nativeDir/win32" \
      "$nativeDir/linux/prebuilds/linux-arm64"
  '' + lib.optionalString (stdenv.hostPlatform.system == "aarch64-darwin") ''
    rm -rf "$nativeDir/linux" "$nativeDir/win32" \
      "$nativeDir/darwin/prebuilds/darwin-x64"
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    export HOME="$TMPDIR/home"
    export PI_OFFLINE=1
    mkdir -p "$HOME"

    test "$("$out/bin/pi" --version)" = "$version"
    "$out/bin/pi" --help >/dev/null
    "$out/bin/pi" --list-models >/dev/null
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
