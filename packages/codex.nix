{ lib, stdenv, fetchurl, autoPatchelfHook, openssl, gcc-unwrapped, libcap, zlib }:

stdenv.mkDerivation rec {
  pname = "codex";
  version = "rust-v0.103.0";

  src = fetchurl {
    url = "https://github.com/openai/codex/releases/download/${version}/codex-x86_64-unknown-linux-gnu.tar.gz";
    hash = "sha256-XR82phI6AA0t/qx0aTBpumd9dp5GGU9sJdQkmzomLmg=";
  };

  nativeBuildInputs = [ autoPatchelfHook ];

  buildInputs = [ libcap openssl gcc-unwrapped.lib zlib ];

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
