{ lib
, stdenv
, src
, version
, nodejs_20
, makeBinaryWrapper
}:

stdenv.mkDerivation {
  pname = "claude-code";
  inherit src version;

  nativeBuildInputs = [ makeBinaryWrapper ];

  installPhase = ''
    mkdir -p $out/lib/claude-code
    cp -r * $out/lib/claude-code/

    mkdir -p $out/bin
    makeBinaryWrapper ${nodejs_20}/bin/node $out/bin/claude \
      --add-flags "$out/lib/claude-code/cli.js" \
      --set DISABLE_AUTOUPDATER 1 \
      --set AUTHORIZED 1 \
      --unset DEV
  '';

  meta = {
    description = "Agentic coding tool that lives in your terminal, understands your codebase, and helps you code faster";
    homepage = "https://github.com/anthropics/claude-code";
    downloadPage = "https://www.npmjs.com/package/@anthropic-ai/claude-code";
    license = lib.licenses.unfree;
    maintainers = with lib.maintainers; [
      malo
      markus1189
      omarjatoi
    ];
    mainProgram = "claude";
  };
}
