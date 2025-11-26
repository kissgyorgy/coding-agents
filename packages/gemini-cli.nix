{ lib
, stdenv
, fetchurl
, nodejs_20
, makeBinaryWrapper
, version
}:

stdenv.mkDerivation rec {
  pname = "gemini-cli";
  inherit version;

  src = fetchurl {
    url = "https://github.com/google-gemini/gemini-cli/releases/download/v${version}/gemini.js";
    hash = "sha256-hKtmIGysnJ2zlpfpd6W2yA2OqPwQW2xdaND6jMe7lgs=";
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
