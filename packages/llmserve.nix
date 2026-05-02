{ lib, rustPlatform, fetchFromGitHub }:

rustPlatform.buildRustPackage rec {
  pname = "llmserve";
  version = "0.0.8";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmserve";
    rev = "v${version}";
    hash = "sha256-j4ko8AkrIOWlM1Tkl/pGMI1PzQc6yImCAZXEmO/NBko=";
  };

  cargoLock.lockFile = "${src}/Cargo.lock";

  meta = {
    description = "TUI for serving local LLM models — pick a model, pick a backend, serve it";
    homepage = "https://github.com/AlexsJones/llmserve";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "llmserve";
  };
}
