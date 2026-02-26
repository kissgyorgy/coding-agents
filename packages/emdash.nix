{ lib, appimageTools, fetchurl, writeShellScriptBin, symlinkJoin }:

let
  pname = "emdash";
  version = "0.4.18";

  src = fetchurl {
    url = "https://github.com/generalaction/emdash/releases/download/v${version}/emdash-x86_64.AppImage";
    hash = "sha256-etJLndX2wIGANmDjquOCiwfhwsGSiAgBjopSFK9C54I=";
  };

  appimageContents = appimageTools.extractType2 { inherit pname version src; };

  unwrapped = appimageTools.wrapType2 {
    inherit pname version src;

    extraInstallCommands = ''
      install -m 444 -D ${appimageContents}/emdash.desktop $out/share/applications/emdash.desktop
      install -m 444 -D ${appimageContents}/emdash.png $out/share/icons/hicolor/512x512/apps/emdash.png
    '';
  };

  wrapper = writeShellScriptBin pname ''
    export APPIMAGE="${unwrapped}/bin/${pname}"
    exec ${unwrapped}/bin/${pname} \
      --enable-features=UseOzonePlatform \
      --ozone-platform=wayland \
      "$@"
  '';
in
symlinkJoin {
  name = "${pname}-${version}";
  paths = [ wrapper unwrapped ];

  meta = {
    description = "Agent orchestration tool";
    homepage = "https://github.com/generalaction/emdash";
    license = lib.licenses.unfree;
    platforms = [ "x86_64-linux" ];
    mainProgram = "emdash";
  };
}
