{ lib
, stdenv
, bun
, makeBinaryWrapper
,
}:

let
  npins = import ../npins;

  pname = "ccusage";
  version = npins.ccusage.version;
  src = npins.ccusage;

  # Create node_modules with bun install
  node_modules = stdenv.mkDerivation {
    name = "${pname}-${version}-node_modules";
    inherit src;

    nativeBuildInputs = [ bun ];

    buildPhase = ''
      bun install --frozen-lockfile --no-progress --ignore-scripts
    '';

    installPhase = ''
      mkdir -p $out
      cp -r node_modules $out/

      # Remove bun cache directory and all broken symlinks except .bin
      rm -rf $out/node_modules/.cache || true
      find $out -type l ! -exec test -e {} \; -not -path "*/.bin/*" -delete || true
    '';

    # Disable automatic fixup to prevent store path references
    dontPatchShebangs = true;
    dontStrip = true;

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-lsphvnkXGIUiqIz2twfgAKKvYlSqqzwXFQH7tdxVdCk=";
  };

in
stdenv.mkDerivation {
  inherit pname version src;

  nativeBuildInputs = [
    bun
    makeBinaryWrapper
  ];

  dontBuild = true;

  installPhase = ''
    mkdir -p $out/lib/${pname}

    # Copy source files and dependencies
    cp -r src package.json tsconfig.json $out/lib/${pname}/
    cp -r ${node_modules}/node_modules $out/lib/${pname}/

    # Create binary wrapper that runs the TypeScript source directly with bun
    mkdir -p $out/bin
    makeBinaryWrapper ${bun}/bin/bun $out/bin/ccusage \
      --add-flags "--prefer-offline --no-install --cwd $out/lib/${pname} src/index.ts"
  '';

  meta = with lib; {
    description = "CLI tool for analyzing Claude Code token usage and costs";
    homepage = "https://github.com/ryoppippi/ccusage";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.linux ++ platforms.darwin;
    mainProgram = "ccusage";
  };
}
