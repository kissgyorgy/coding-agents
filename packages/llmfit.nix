{ lib, rustPlatform, fetchFromGitHub }:

rustPlatform.buildRustPackage rec {
  pname = "llmfit";
  version = "1.1.7";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmfit";
    rev = "v${version}";
    hash = "sha256-FVzo6i8rqGP9wP8ipu5S9/keP/W2w9um8vFbxUzujWI=";
  };

  cargoLock.lockFile = "${src}/Cargo.lock";

  buildAndTestSubdir = "llmfit-tui";

  meta = {
    description = "Right-size LLM models to your system hardware";
    homepage = "https://github.com/AlexsJones/llmfit";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "llmfit";
  };
}
