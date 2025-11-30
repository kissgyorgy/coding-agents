{ lib
, stdenv
, src
, version
, nodejs_20
, makeBinaryWrapper
}:

stdenv.mkDerivation {
  pname = "ccusage";
  inherit src version;

  nativeBuildInputs = [ makeBinaryWrapper ];

  installPhase = ''
    mkdir -p $out/lib/ccusage
    cp -r * $out/lib/ccusage/

    mkdir -p $out/bin
    makeBinaryWrapper ${nodejs_20}/bin/node $out/bin/ccusage \
      --add-flags "$out/lib/ccusage/dist/index.js"
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
