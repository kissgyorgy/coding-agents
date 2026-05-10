{ lib, rustPlatform, fetchFromGitHub }:

rustPlatform.buildRustPackage rec {
  pname = "llmfit";
  version = "0.9.23";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmfit";
    rev = "v${version}";
    hash = "sha256-KtmXNlKPz4W2hfLa1iTPUVrocEjXWfTcoMwcznV4ZEk=";
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
