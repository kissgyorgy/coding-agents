{ lib, stdenv, fetchurl, autoPatchelfHook, glibc }:

stdenv.mkDerivation rec {
  pname = "crush";
  version = "0.44.0";

  src = fetchurl {
    url = "https://github.com/charmbracelet/crush/releases/download/v${version}/crush_${version}_Linux_x86_64.tar.gz";
    hash = "sha256-APpcMGuz38PMB2Hr+nKNZisu0NqxZNzHoTuXf2NidR8=";
  };

  nativeBuildInputs = [ autoPatchelfHook ];

  buildInputs = [ glibc ];

  sourceRoot = "crush_${version}_Linux_x86_64";

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
    platforms = [ "x86_64-linux" ];
    mainProgram = "crush";
  };
}
