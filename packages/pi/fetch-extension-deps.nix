{ buildNpmPackage }:

buildNpmPackage {
  pname = "pi-fetch-extension-deps";
  version = "0.1.0";

  src = ../../home-manager/pi-coding-agent/extensions/fetch;

  npmDepsHash = "sha256-fE2LKA2iVWI9KOXOuOWv7ttDaI5sDrE1ArI7jYDE+f4=";

  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r node_modules $out/
    runHook postInstall
  '';
}
