{ lib, stdenv, fetchurl, nodejs_20, makeBinaryWrapper }:

stdenv.mkDerivation rec {
  pname = "ccusage";
  version = "17.1.6";

  src = fetchurl {
    url = "https://registry.npmjs.org/ccusage/-/ccusage-${version}.tgz";
    hash = "sha256-761kjIRRSqulnPf8FaEXcbOFVfPgkeOkZKPmrShUnHc=";
  };

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
