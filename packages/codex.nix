{ lib
, stdenv
, src
, autoPatchelfHook
, openssl
, gcc-unwrapped
}:
stdenv.mkDerivation rec {
  pname = "codex";
  version = "rust-v0.63.0";
  inherit src;

  nativeBuildInputs = [ autoPatchelfHook ];

  buildInputs = [ openssl gcc-unwrapped.lib ];

  dontUnpack = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 $src/codex-x86_64-unknown-linux-gnu $out/bin/codex

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
