{ lib, buildNpmPackage, fetchFromGitHub, nodejs_22, makeBinaryWrapper }:

buildNpmPackage rec {
  pname = "gemini-cli";
  version = "0.50.0";

  src = fetchFromGitHub {
    owner = "google-gemini";
    repo = "gemini-cli";
    rev = "v${version}";
    hash = "sha256-P1ZoNQx3VAx2FC5OmHOuFeOnnkHgOIRW2CVD8JbqNJ0=";
  };

  nodejs = nodejs_22;
  npmDepsHash = "sha256-8SO7gv5Jp0wtIwB9su/vrEGFvkNHEprABdxI9JWKuTI=";

  nativeBuildInputs = [ makeBinaryWrapper ];

  npmFlags = [ "--ignore-scripts" ];

  postPatch = ''
    substituteInPlace package.json \
      --replace-fail '"prepare": "husky && npm run bundle"' '"prepare": ""'
  '';

  buildPhase = ''
    runHook preBuild

    mkdir -p packages/cli/src/generated packages/core/src/generated
    cat > packages/cli/src/generated/git-commit.ts << 'GENEOF'
    export const GIT_COMMIT_INFO = 'v${version}';
    export const CLI_VERSION = '${version}';
    GENEOF
    cp packages/cli/src/generated/git-commit.ts packages/core/src/generated/git-commit.ts

    npm run build --workspace=@google/gemini-cli-devtools
    npm run build --workspace=@google/gemini-cli-core
    node esbuild.config.js
    node scripts/copy_bundle_assets.js

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/gemini-cli
    cp -r bundle/* $out/lib/gemini-cli/

    mkdir -p $out/bin
    makeBinaryWrapper ${nodejs}/bin/node $out/bin/gemini \
      --add-flags "$out/lib/gemini-cli/gemini.js"

    runHook postInstall
  '';

  meta = {
    description = "Open-source AI agent that brings the power of Gemini directly into your terminal";
    homepage = "https://github.com/google-gemini/gemini-cli";
    downloadPage = "https://github.com/google-gemini/gemini-cli/releases";
    license = lib.licenses.asl20;
    maintainers = [ ];
    mainProgram = "gemini";
  };
}
