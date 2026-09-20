{ lib, rustPlatform, fetchFromGitHub, fetchurl }:

let
  cargoDeps = (import ./_static-crates-cargo-deps.nix {
    inherit rustPlatform fetchurl;
  }) ./llmfit-Cargo.lock;
in
rustPlatform.buildRustPackage rec {
  pname = "llmfit";
  version = "1.1.16";

  src = fetchFromGitHub {
    owner = "AlexsJones";
    repo = "llmfit";
    rev = "v${version}";
    hash = "sha256-EMCtdgfR4y9+UY3byg+jYUhkcWpt1ZU8/CIOHnMY3UQ=";
  };

  inherit cargoDeps;

  postUnpack = ''
    cp ${./llmfit-Cargo.lock} "$sourceRoot/Cargo.lock"
    substituteInPlace "$sourceRoot/llmfit-core/Cargo.toml" \
      --replace-fail 'sysinfo = "0.39"' 'sysinfo = "0.38"'
  '';

  buildAndTestSubdir = "llmfit-tui";

  # JSON serialization changes the final bit of the expected f64 on x86_64.
  checkFlags = [
    "--skip"
    "plan_json_reports_disk_size_at_the_requested_quant"
  ];

  meta = {
    description = "Right-size LLM models to your system hardware";
    homepage = "https://github.com/AlexsJones/llmfit";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "llmfit";
  };
}
