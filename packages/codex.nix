{ lib, stdenv, fetchurl, autoPatchelfHook, openssl, gcc-unwrapped, libcap, zlib }:

stdenv.mkDerivation rec {
  pname = "codex";
  version = "rust-v0.128.0";

  src = fetchurl {
    url = "https://github.com/openai/codex/releases/download/${version}/codex-x86_64-unknown-linux-musl.tar.gz";
    hash = "sha256-iGuF5hGMC0MjRDfKAH++kjYRpTsQPQDg0650rvsg4jo=";
  };

  nativeBuildInputs = [ autoPatchelfHook ];

  buildInputs = [ libcap openssl gcc-unwrapped.lib zlib ];

  sourceRoot = ".";

  installPhase = ''
    runHook preInstall

    install -Dm755 codex-x86_64-unknown-linux-musl $out/bin/codex

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
