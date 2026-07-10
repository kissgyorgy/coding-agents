{ lib, rustPlatform, fetchFromGitHub }:

rustPlatform.buildRustPackage rec {
  pname = "llmserve";
  version = "0.0.10";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmserve";
    rev = "v${version}";
    hash = "sha256-V0DtCjTQhgfO/WQy/OZc2ayDY9nl2YzstCnsoRAJDFo=";
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
