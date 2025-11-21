{ lib
, stdenv
, fetchurl
, autoPatchelfHook
, openssl
, gcc-unwrapped
, version
}:
stdenv.mkDerivation rec {
  pname = "codex";
  inherit version;

  src = fetchurl {
    url = "https://github.com/openai/codex/releases/download/${version}/codex-x86_64-unknown-linux-gnu.tar.gz";
    hash = "sha256-1D8a3nVepVLtxRdlf2Vc/W7P0Dou4eEIZwLeeWuHKG4=";
  };

  nativeBuildInputs = [ autoPatchelfHook ];

  buildInputs = [ openssl gcc-unwrapped.lib ];

  sourceRoot = ".";

  installPhase = ''
    runHook preInstall

    install -Dm755 codex-x86_64-unknown-linux-gnu $out/bin/codex

    runHook postInstall
  '';

  meta = with lib; {
    description = "AI code assistant that helps developers write, debug, and understand code";
    homepage = "https://github.com/openai/codex";
    license = licenses.unfree;
    maintainers = [ ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "codex";
  };
}
