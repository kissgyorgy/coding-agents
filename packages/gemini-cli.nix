{ lib, stdenv, fetchurl, nodejs_20, makeBinaryWrapper }:

stdenv.mkDerivation rec {
  pname = "gemini-cli";
  version = "0.30.1";

  src = fetchurl {
    url = "https://github.com/google-gemini/gemini-cli/releases/download/v${version}/gemini.js";
    hash = "sha256-buz+MLxDjlAVAHbG60KU71uQUCGKNPN2OgNMV3mym7w=";
  };

  dontUnpack = true;
  nativeBuildInputs = [ makeBinaryWrapper ];

  installPhase = ''
    mkdir -p $out/lib/gemini-cli
    cp $src $out/lib/gemini-cli/gemini.js

    mkdir -p $out/bin
    makeBinaryWrapper ${nodejs_20}/bin/node $out/bin/gemini \
      --add-flags "$out/lib/gemini-cli/gemini.js"
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
