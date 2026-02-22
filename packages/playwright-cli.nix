{ lib, buildNpmPackage, fetchFromGitHub, makeWrapper, google-chrome }:

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
      --set-default PLAYWRIGHT_MCP_EXECUTABLE_PATH ${google-chrome}/bin/google-chrome-stable \
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
