{ lib
, rustPlatform
, fetchFromGitHub
, fetchPnpmDeps
, pnpmConfigHook
, pnpm_10
, nodejs_22
, cmake
, pkg-config
, openssl
, perl
, nasm
, libclang
, clang
, lld
, zlib
, stdenv
}:

let
  version = "0.1.19";
  tag = "v${version}-20260225145008";

  src = fetchFromGitHub {
    owner = "BloopAI";
    repo = "vibe-kanban";
    rev = tag;
    hash = "sha256-1A5ifuCHjOix4LGc0swubPrciZi9W0tkpoGqvw2/Dnw=";
  };

  frontend = stdenv.mkDerivation {
    pname = "vibe-kanban-frontend";
    inherit version src;

    pnpmDeps = fetchPnpmDeps {
      pname = "vibe-kanban-frontend-pnpm-deps";
      inherit version src;
      hash = "sha256-HVIZdMb05yE7JdjwZ/7hyhD/BOP5uw7wtdiwPhtLJJk=";
      fetcherVersion = 3;
    };

    nativeBuildInputs = [
      nodejs_22
      pnpm_10
      pnpmConfigHook
    ];

    buildPhase = ''
      runHook preBuild
      cd packages/local-web
      pnpm run build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      cp -r dist $out
      runHook postInstall
    '';
  };

in
rustPlatform.buildRustPackage rec {
  pname = "vibe-kanban";
  inherit version src;

  cargoHash = "sha256-2dLJXA3VTdT96j4xMkqxQz0OClgz2xhtLbKs25cKI84=";

  nativeBuildInputs = [
    cmake
    pkg-config
    perl
    nasm
    clang
    lld
  ];

  buildInputs = [
    openssl
    zlib
  ];

  preBuild = ''
    # The server binary embeds the frontend via rust-embed from packages/local-web/dist
    mkdir -p packages/local-web/dist
    cp -r ${frontend}/* packages/local-web/dist/

    # codex-core vendor crate uses include_str! with a relative path to node-version.txt
    # that doesn't exist in the vendored copy — create it where the relative path expects it
    vendorDir=$(echo $NIX_BUILD_TOP/vibe-kanban-*-vendor)
    echo "24.13.1" > "$vendorDir/codex-core-0.101.0/src/tools/js_repl/../../../../node-version.txt"
  '';

  env = {
    SQLX_OFFLINE = "true";
    LIBCLANG_PATH = "${libclang.lib}/lib";
    # Bundled native libs to avoid version mismatch issues
    LIBGIT2_NO_PKG_CONFIG = "1";
    LIBSQLITE3_SYS_BUNDLED = "1";
    # Disable telemetry/monitoring (no secrets available)
    POSTHOG_API_KEY = "";
    POSTHOG_API_ENDPOINT = "";
    SENTRY_DSN = "";
    VK_SHARED_API_BASE = "https://api.vibekanban.com";
    # Avoid aws-lc-sys cmake failures when release profile includes debug info
    CARGO_PROFILE_RELEASE_DEBUG = "0";
  };

  buildNoDefaultFeatures = true;

  # Build only the three binaries we need (workspace excludes "remote" already)
  cargoBuildFlags = [
    "-p"
    "server"
    "-p"
    "mcp"
    "-p"
    "review"
    "--bin"
    "server"
    "--bin"
    "mcp_task_server"
    "--bin"
    "review"
  ];

  # Tests need network access and a running database
  doCheck = false;

  postInstall = ''
    mv $out/bin/server $out/bin/vibe-kanban
    mv $out/bin/mcp_task_server $out/bin/vibe-kanban-mcp
    mv $out/bin/review $out/bin/vibe-kanban-review
  '';

  meta = {
    description = "Kanban-style orchestration surface for AI coding agents";
    homepage = "https://github.com/BloopAI/vibe-kanban";
    license = lib.licenses.asl20;
    maintainers = [ ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "vibe-kanban";
  };
}
