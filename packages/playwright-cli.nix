{ lib, buildNpmPackage, fetchFromGitHub, makeWrapper, google-chrome, chromium, stdenv }:

let
  browser =
    if stdenv.hostPlatform.system == "aarch64-linux" then chromium
    else google-chrome;
in
buildNpmPackage rec {
  pname = "playwright-cli";
  version = "0.1.1";

  src = fetchFromGitHub {
    owner = "microsoft";
    repo = "playwright-cli";
    rev = "v${version}";
    hash = "sha256-Ao3phIPinliFDK04u/V3ouuOfwMDVf/qBUpQPESziFQ=";
  };

  npmDepsHash = "sha256-4x3ozVrST6LtLoHl9KtmaOKrkYwCK84fwEREaoNaESc=";

  nativeBuildInputs = [ makeWrapper ];

  dontNpmBuild = true;

  postFixup = ''
    wrapProgram $out/bin/playwright-cli \
      --set-default PLAYWRIGHT_MCP_EXECUTABLE_PATH ${browser}/bin/${browser.meta.mainProgram or "chromium"} \
      --set-default PLAYWRIGHT_MCP_BROWSER chrome \
      --set-default PLAYWRIGHT_MCP_HEADLESS false
  '';

  meta = {
    description = "Playwright CLI with skills for browser automation in coding agents";
    homepage = "https://github.com/microsoft/playwright-cli";
    license = lib.licenses.asl20;
    maintainers = [ ];
    mainProgram = "playwright-cli";
  };
}
