{ lib, rustPlatform, fetchFromGitHub }:

rustPlatform.buildRustPackage rec {
  pname = "llmfit";
  version = "1.1.12";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmfit";
    rev = "v${version}";
    hash = "sha256-JUlCHA/KM9M/71a2XCVIq5+5O43bvceXFxWwSaA6Qak=";
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
