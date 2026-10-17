{ callPackage, pi }:

let
  fetchExtensionDeps = callPackage ./fetch-extension-deps.nix { };
in
pi.overrideAttrs (old: {
  # Preserve upstream's runtime tools on PATH and native-library checks.
  postInstall = (old.postInstall or "") + ''
    wrapProgram "$out/bin/pi" \
      --set PI_TELEMETRY "0" \
      --prefix NODE_PATH : "${fetchExtensionDeps}/node_modules"
  '';
})
