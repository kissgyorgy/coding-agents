{ lib, stdenv, fetchurl, glibc ? null }:

let
  sources = {
    x86_64-linux = {
      platform = "linux-x64";
      hash = "sha256-SvQA+nTIiR1psM2eNwTvSRM996GdXGZFb6D16EJ24WA=";
    };
    aarch64-darwin = {
      platform = "darwin-arm64";
      hash = "sha256-h6HQUBjOrfwf5ha/wQJisFA/UZhvSvLcQtHthW7T97s=";
    };
  };
  source = sources.${stdenv.hostPlatform.system} or (throw "claude-code is not supported on ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation rec {
  pname = "claude-code";
  version = "2.1.129";

  src = fetchurl {
    url = "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${version}/${source.platform}/claude";
    hash = source.hash;
  };

  dontUnpack = true;
  dontPatchELF = true;
  dontStrip = true;

  installPhase = ''
    mkdir -p $out/bin
    cp $src $out/bin/claude
    chmod u+w,+x $out/bin/claude
  '' + lib.optionalString stdenv.hostPlatform.isLinux ''
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
    platforms = builtins.attrNames sources;
  };
}
