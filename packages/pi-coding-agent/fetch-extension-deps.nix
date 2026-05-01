{ buildNpmPackage }:

buildNpmPackage {
  pname = "pi-fetch-extension-deps";
  version = "0.1.0";

  src = ../../home-manager/pi-coding-agent/extensions/fetch;

  npmDepsHash = "sha256-J3sSfyLxALpJAiq5MqTmvWDx0Hip1xHdcaKkUr3ouUk=";

  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r node_modules $out/
    runHook postInstall
  '';
}
