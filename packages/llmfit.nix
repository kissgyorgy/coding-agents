{ lib, rustPlatform, fetchFromGitHub }:

rustPlatform.buildRustPackage rec {
  pname = "llmfit";
  version = "1.1.11";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmfit";
    rev = "v${version}";
    hash = "sha256-fecb52SZHgrqv4KV9tGiEEWF9EROv7kK9ZT2fOqnO6Y=";
  };

  cargoLock.lockFile = ./llmfit-Cargo.lock;

  postUnpack = ''
    cp ${./llmfit-Cargo.lock} "$sourceRoot/Cargo.lock"
    substituteInPlace "$sourceRoot/llmfit-core/Cargo.toml" \
      --replace-fail 'sysinfo = "0.39"' 'sysinfo = "0.38"'
  '';

  buildAndTestSubdir = "llmfit-tui";

  meta = {
    description = "Right-size LLM models to your system hardware";
    homepage = "https://github.com/AlexsJones/llmfit";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "llmfit";
  };
}
