{ lib, buildNpmPackage, fetchFromGitHub, nodejs_20, bun }:

buildNpmPackage rec {
  pname = "openclaude";
  version = "0.8.0";

  src = fetchFromGitHub {
    owner = "Gitlawb";
    repo = "openclaude";
    rev = "v${version}";
    hash = "sha256-sZ/59hDoPfrawDrl10kz8EcyR976darE5qRSM+OxlrI=";
  };

  nodejs = nodejs_20;
  npmDepsHash = "sha256-yAtDQJS8Vvcf7Sik69Ho/MMm7Df+iPds+z/rwh5R/Mk=";

  nativeBuildInputs = [ bun ];

  npmFlags = [ "--ignore-scripts" ];
  npmBuildScript = "build";

  postPatch = ''
    cp ${./openclaude-package-lock.json} package-lock.json
  '';

  meta = {
    description = "Open-source coding-agent CLI for cloud and local model providers";
    homepage = "https://github.com/Gitlawb/openclaude";
    downloadPage = "https://github.com/Gitlawb/openclaude/releases";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "openclaude";
  };
}
