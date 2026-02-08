{ lib, stdenv, fetchurl, makeWrapper }:

stdenv.mkDerivation rec {
  pname = "pi-coding-agent";
  version = "0.52.9";

  src = fetchurl {
    url = "https://github.com/badlogic/pi-mono/releases/download/v${version}/pi-linux-x64.tar.gz";
    hash = "sha256-oTzIqkcuLNVb8QGvAImzAjGNCuB0OZtzz6NSvhzGxRQ=";
  };

  sourceRoot = "pi";

  nativeBuildInputs = [ makeWrapper ];

  dontPatchELF = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/pi-coding-agent $out/bin
    cp -r ./* $out/lib/pi-coding-agent/

    chmod u+w,+x $out/lib/pi-coding-agent/pi
    patchelf --set-interpreter ${stdenv.cc.bintools.dynamicLinker} $out/lib/pi-coding-agent/pi

    makeWrapper $out/lib/pi-coding-agent/pi $out/bin/pi \
      --set PI_PACKAGE_DIR $out/lib/pi-coding-agent

    runHook postInstall
  '';

  meta = with lib; {
    description = "Minimal terminal coding harness with AI-powered agent capabilities";
    homepage = "https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent";
    downloadPage = "https://github.com/badlogic/pi-mono/releases";
    sourceProvenance = [ sourceTypes.binaryNativeCode ];
    license = licenses.mit;
    maintainers = [ ];
    mainProgram = "pi";
    platforms = [ "x86_64-linux" ];
  };
}
