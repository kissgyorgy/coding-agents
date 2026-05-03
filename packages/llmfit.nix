{ lib, rustPlatform, fetchFromGitHub }:

rustPlatform.buildRustPackage rec {
  pname = "llmfit";
  version = "0.9.19";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmfit";
    rev = "v${version}";
    hash = "sha256-5k8s9BrPQzERwekSzhcYMLHaPB9sh+e+7T+XYSxd5BA=";
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
