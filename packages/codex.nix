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
      hash = "sha256-se+5UJdmDX8uWjiHYYoj8uobDVSAeL+SsPel0imgzvI=";
      codeModeHostHash = "sha256-MMyUX3ez7tFe44XML4RKM78dfEIv86lxYfcBv/5Pd/g=";
    };
    aarch64-darwin = {
      target = "aarch64-apple-darwin";
      hash = "sha256-vYNHnzriFHTEB+whZPvCpj+nY/evu9Ej+2ppxSAc/Tg=";
      codeModeHostHash = "sha256-ghIkFYxRMEyz8Zr28/qFykVm2KEr4Hh2BM8Q8HDExkQ=";
    };
  };
  source = sources.${stdenv.hostPlatform.system} or (throw "codex is not supported on ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation rec {
  pname = "codex";
  version = "rust-v0.161.0";

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
