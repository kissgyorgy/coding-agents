{ lib
, stdenv
, fetchurl
, autoPatchelfHook ? null
, openssl ? null
, gcc-unwrapped ? null
, libcap ? null
, zlib ? null
}:

let
  sources = {
    x86_64-linux = {
      target = "x86_64-unknown-linux-musl";
      hash = "sha256-W6O5QFVDlTCB9mHQhU0mb3biq75R1BNJNVo23nZzd2o=";
      codeModeHostHash = "sha256-oUBzH1TnA5NV0YlHnfx9BZtsCocXbHoBHS8nGpkUE5o=";
    };
    aarch64-darwin = {
      target = "aarch64-apple-darwin";
      hash = "sha256-J1ATLTAOZPHb/7lePZE/2cnceBK8jhvOXGE1cki3kp4=";
      codeModeHostHash = "sha256-QKRdHviip++IXB++bh/w0dKlO+9AJz85uisY9NrYa/I=";
    };
  };
  source = sources.${stdenv.hostPlatform.system} or (throw "codex is not supported on ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation rec {
  pname = "codex";
  version = "rust-v0.146.0";

  src = fetchurl {
    url = "https://github.com/openai/codex/releases/download/${version}/codex-${source.target}.tar.gz";
    hash = source.hash;
  };

  codeModeHostSrc = fetchurl {
    url = "https://github.com/openai/codex/releases/download/${version}/codex-code-mode-host-${source.target}.tar.gz";
    hash = source.codeModeHostHash;
  };

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ libcap openssl gcc-unwrapped.lib zlib ];

  sourceRoot = ".";

  dontStrip = stdenv.hostPlatform.isDarwin;

  installPhase = ''
    runHook preInstall

    install -Dm755 codex-${source.target} $out/bin/codex
    tar -xzf ${codeModeHostSrc}
    install -Dm755 codex-code-mode-host-${source.target} $out/bin/codex-code-mode-host

    runHook postInstall
  '';

  meta = with lib; {
    description = "AI code assistant that helps developers write, debug, and understand code";
    homepage = "https://github.com/openai/codex";
    license = licenses.unfree;
    maintainers = [ ];
    platforms = builtins.attrNames sources;
    mainProgram = "codex";
  };
}
