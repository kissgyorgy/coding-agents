{ lib
, rustPlatform
, fetchFromGitHub
, pkg-config
, installShellFiles
, versionCheckHook
,
}:

rustPlatform.buildRustPackage rec {
  pname = "aichat";
  version = "0.30.0";

  src = fetchFromGitHub {
    owner = "sigoden";
    repo = "aichat";
    rev = "v${version}";
    hash = "sha256-xgTGii1xGtCc1OLoC53HAtQ+KVZNO1plB2GVtVBBlqs=";
  };

  cargoHash = "sha256-u2JBPm03qvuLEUOEt4YL9O750V2QPgZbxvsvlTQe2nk=";

  nativeBuildInputs = [
    pkg-config
    installShellFiles
  ];

  postInstall = ''
    installShellCompletion ./scripts/completions/aichat.{bash,fish,zsh}
  '';

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;

  meta = {
    description = "All-in-one LLM CLI tool";
    homepage = "https://github.com/sigoden/aichat";
    license = with lib.licenses; [ mit asl20 ];
    maintainers = [ ];
    mainProgram = "aichat";
  };
}
