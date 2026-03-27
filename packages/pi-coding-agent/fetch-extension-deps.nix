{ buildNpmPackage }:

buildNpmPackage {
  pname = "pi-fetch-extension-deps";
  version = "0.1.0";

  src = ../../home-manager/pi-coding-agent/extensions/fetch;

  npmDepsHash = "sha256-sV0EW4/4tqMyqidF2f2m8WAgHiR5Ih08Mp76mCgFw2E=";

  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r node_modules $out/
    runHook postInstall
  '';
}
