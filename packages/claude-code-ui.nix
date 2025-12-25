{ lib, buildNpmPackage, fetchFromGitHub, nodejs_20, python3, node-gyp, makeWrapper }:

buildNpmPackage rec {
  pname = "claude-code-ui";
  version = "1.12.0";

  src = fetchFromGitHub {
    owner = "siteboon";
    repo = "claudecodeui";
    rev = "v${version}";
    hash = "sha256-/fN3MWNR5SenwI/JZFHh2+oKSuKUCLaHf4+rVX7SV5A=";
  };

  nodejs = nodejs_20;

  npmDepsHash = "sha256-lH2P+2C8zeJLdkSFLZlfDrppuSV7Lf7nKW2by0GFGrg=";

  nativeBuildInputs = [ python3 node-gyp makeWrapper ];

  postInstall = ''
    wrapProgram $out/bin/claude-code-ui \
      --run 'export DATABASE_PATH="''${DATABASE_PATH:-$HOME/.claude-code-ui/auth.db}"'
  '';

  meta = {
    description = "Web UI for Claude Code CLI";
    homepage = "https://github.com/siteboon/claude-code-ui";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "claude-code-ui";
  };
}
