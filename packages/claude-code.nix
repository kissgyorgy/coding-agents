{ lib, stdenv, fetchurl, glibc ? null, makeBinaryWrapper, alsa-lib, alsa-utils, sox }:

let
  sources = {
    x86_64-linux = {
      platform = "linux-x64";
      hash = "sha256-tzZ2QwrxL5cxanmLg3H4HWQPkKWL3LjzzlaoNbtH31Y=";
    };
    aarch64-darwin = {
      platform = "darwin-arm64";
      hash = "sha256-/7ZDMbwO4bae+3wsQovTq1Frwxt1v2CIazVsl8HCX/0=";
    };
  };
  source = sources.${stdenv.hostPlatform.system} or (throw "claude-code is not supported on ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation rec {
  pname = "claude-code";
  version = "2.1.310";

  src = fetchurl {
    url = "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${version}/${source.platform}/claude";
    hash = source.hash;
  };

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ makeBinaryWrapper ];

  dontUnpack = true;
  dontPatchELF = true;
  dontStrip = true;

  installPhase = ''
    mkdir -p $out/bin
    cp $src $out/bin/claude
    chmod u+w,+x $out/bin/claude
  '' + lib.optionalString stdenv.hostPlatform.isLinux ''
    patchelf --set-interpreter ${glibc}/lib/ld-linux-x86-64.so.2 $out/bin/claude

    # Voice tries native ALSA, arecord, then SoX rec. SoX includes the
    # PulseAudio backend needed on WSLg and PipeWire/PulseAudio desktops.
    wrapProgram $out/bin/claude \
      --set DISABLE_AUTOUPDATER 1 \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ alsa-lib ]} \
      --prefix PATH : ${lib.makeBinPath [ alsa-utils sox ]}
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
