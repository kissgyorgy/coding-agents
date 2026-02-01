{ lib, stdenv, fetchurl, glibc }:

stdenv.mkDerivation rec {
  pname = "claude-code";
  version = "2.1.29";

  src = fetchurl {
    url = "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${version}/linux-x64/claude";
    hash = "sha256-Q2OjrNjDnGRadGD/uhOdBiyjjd9ANiUI6gviAVnEOYw=";
  };

  dontUnpack = true;
  dontPatchELF = true;
  dontStrip = true;

  installPhase = ''
    mkdir -p $out/bin
    cp $src $out/bin/claude
    chmod u+w,+x $out/bin/claude
    patchelf --set-interpreter ${glibc}/lib/ld-linux-x86-64.so.2 $out/bin/claude
  '';

  meta = {
    description = "Agentic coding tool that lives in your terminal, understands your codebase, and helps you code faster";
    homepage = "https://github.com/anthropics/claude-code";
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    license = lib.licenses.unfree;
    maintainers = with lib.maintainers; [
      malo
      markus1189
      omarjatoi
    ];
    mainProgram = "claude";
    platforms = [ "x86_64-linux" ];
  };
}
