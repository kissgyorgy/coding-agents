{ lib, stdenv, fetchurl, autoPatchelfHook ? null, glibc ? null }:

let
  sources = {
    x86_64-linux = {
      asset = "Linux_x86_64";
      hash = "sha256-FHVEkKZJodTQE1WPuBDKiWRX88ZTSk1Z5wcJ9zKCrXY=";
    };
    aarch64-darwin = {
      asset = "Darwin_arm64";
      hash = "sha256-ZeDKDTtMsdKFNnSvKBTlSltasFI6MBSYDfibLrDfccE=";
    };
  };
  source = sources.${stdenv.hostPlatform.system} or (throw "crush is not supported on ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation rec {
  pname = "crush";
  version = "0.84.1";

  src = fetchurl {
    url = "https://github.com/charmbracelet/crush/releases/download/v${version}/crush_${version}_${source.asset}.tar.gz";
    hash = source.hash;
  };

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ glibc ];

  sourceRoot = "crush_${version}_${source.asset}";

  dontStrip = stdenv.hostPlatform.isDarwin;

  installPhase = ''
    runHook preInstall

    install -Dm755 crush $out/bin/crush

    install -Dm644 completions/crush.bash $out/share/bash-completion/completions/crush.bash
    install -Dm644 completions/crush.fish $out/share/fish/vendor_completions.d/crush.fish
    install -Dm644 completions/crush.zsh $out/share/zsh/site-functions/_crush

    install -Dm644 manpages/crush.1.gz $out/share/man/man1/crush.1.gz

    runHook postInstall
  '';

  meta = with lib; {
    description = "AI coding agent from Charm";
    homepage = "https://github.com/charmbracelet/crush";
    license = licenses.unfree;
    maintainers = [ ];
    platforms = builtins.attrNames sources;
    mainProgram = "crush";
  };
}
