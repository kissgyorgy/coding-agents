{ lib, stdenv, fetchurl, autoPatchelfHook ? null, glibc ? null }:

let
  sources = {
    x86_64-linux = {
      asset = "Linux_x86_64";
      hash = "sha256-Il6zmt/2VBkPsdGvtMKKaKOeg5fkR3mJYDXo+7Xx3hY=";
    };
    aarch64-darwin = {
      asset = "Darwin_arm64";
      hash = "sha256-xlXAcJEwC5XkMalq9fVo40M0J69T1gZJiu65n4cHNtA=";
    };
  };
  source = sources.${stdenv.hostPlatform.system} or (throw "crush is not supported on ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation rec {
  pname = "crush";
  version = "0.91.2";

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
