{ lib, rustPlatform, fetchFromGitHub, fetchurl }:

let
  # crates.io's API download endpoint currently returns HTTP 403, while the
  # immutable static crate endpoint remains available.
  fetchStaticCrate = args:
    let
      urlParts = builtins.match "https://crates.io/api/v1/crates/([^/]+)/([^/]+)/download" args.url;
      crateName = builtins.elemAt urlParts 0;
      crateVersion = builtins.elemAt urlParts 1;
    in
    fetchurl (args // {
      url = "https://static.crates.io/crates/${crateName}/${crateName}-${crateVersion}.crate";
    });

  cargoDeps = (rustPlatform.importCargoLock.override {
    fetchurl = fetchStaticCrate;
  }) {
    lockFile = ./llmfit-Cargo.lock;
  };
in
rustPlatform.buildRustPackage rec {
  pname = "llmfit";
  version = "1.1.14";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmfit";
    rev = "v${version}";
    hash = "sha256-+N2NFqIhIRIxhXASapGd8CSnmvRzYxUMwgKiGuYlefc=";
  };

  inherit cargoDeps;

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
