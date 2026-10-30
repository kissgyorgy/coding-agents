{ lib
, stdenv
, stdenvNoCC
, fetchurl
, autoPatchelfHook
, makeWrapper
, makeDesktopItem
, bash
, git
, herdr-core
, libGL
, libxcb
, libxkbcommon
, vulkan-loader
, wayland
, xdg-utils
}:

let
  desktopItem = makeDesktopItem {
    name = "herdr-app";
    desktopName = "Herdr";
    comment = "Terminals and coding agents that keep running";
    exec = "herdr-app";
    icon = "herdr-app";
    terminal = false;
    categories = [ "Development" ];
    startupWMClass = "herdr-app";
  };
in
stdenvNoCC.mkDerivation rec {
  pname = "herdr-app";
  version = "0.1.9";

  src = fetchurl {
    url = "https://releases.herdr.dev/app/${version}/herdr-app-linux-x86_64.tar.gz";
    hash = "sha256-2m97QPbEFsW03vjbz4t2Z30Cvk9LRdBqTWWHZoUOC0U=";
  };

  sourceRoot = "herdr-app";
  nativeBuildInputs = [ autoPatchelfHook makeWrapper ];
  buildInputs = [ stdenv.cc.cc.lib libxcb libxkbcommon ];

  # GPUI/wgpu loads the display and graphics libraries with dlopen.
  runtimeDependencies = [ libGL vulkan-loader wayland ];

  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 herdr-app $out/bin/herdr-app
    # Keeping the icon outside bin also disables upstream's mutable app updater.
    install -Dm644 herdr-app.svg $out/share/icons/hicolor/scalable/apps/herdr-app.svg
    install -Dm644 LICENSE $out/share/doc/herdr-app/LICENSE
    install -Dm644 THIRD-PARTY-NOTICES $out/share/doc/herdr-app/THIRD-PARTY-NOTICES
    mkdir -p $out/share/applications
    cp ${desktopItem}/share/applications/herdr-app.desktop $out/share/applications/
    substituteInPlace $out/share/applications/herdr-app.desktop \
      --replace-fail 'Exec=herdr-app' "Exec=$out/bin/herdr-app"

    runHook postInstall
  '';

  postFixup = ''
    wrapProgram $out/bin/herdr-app \
      --prefix PATH : ${lib.makeBinPath [ herdr-core bash git xdg-utils ]}
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    $out/bin/herdr-app --version
    $out/bin/herdr-app --help > /dev/null
    runHook postInstallCheck
  '';

  meta = {
    description = "Native desktop app for persistent terminals and coding agents";
    homepage = "https://github.com/herdrdev/herdr-app";
    license = lib.licenses.asl20;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "herdr-app";
  };
}
