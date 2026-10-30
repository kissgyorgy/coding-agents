{ lib
, stdenvNoCC
, fetchurl
, makeWrapper
, bash
, openssh
, systemd
}:

stdenvNoCC.mkDerivation rec {
  pname = "herdr-core";
  version = "0.1.14";

  src = fetchurl {
    url = "https://releases.herdr.dev/core/${version}/herdr-core-linux-x86_64.tar.gz";
    hash = "sha256-6dur3q0M4M495RtvVMyVSe/tu0Gy+ESLaTKrDRRCND4=";
  };

  sourceRoot = ".";
  nativeBuildInputs = [ makeWrapper ];
  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 herdr-core $out/bin/herdr-core
    wrapProgram $out/bin/herdr-core \
      --prefix PATH : ${lib.makeBinPath [ bash openssh systemd ]}
    ln -s herdr-core $out/bin/hc

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    $out/bin/herdr-core --version
    $out/bin/hc --help > /dev/null
    runHook postInstallCheck
  '';

  meta = {
    description = "Persistent terminal runtime for coding agents";
    homepage = "https://github.com/herdrdev/herdr-core";
    license = lib.licenses.asl20;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "hc";
  };
}
