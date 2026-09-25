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
      hash = "sha256-2z/jrao1xQ7ftoqYihF3gv40kpYPtj1wA+tnSMzAZXs=";
      codeModeHostHash = "sha256-R9MkGeiVyc3btmSiiQv7JQ7w4/3tPacOXyvGFHnxmJw=";
    };
    aarch64-darwin = {
      target = "aarch64-apple-darwin";
      hash = "sha256-DxUiNiv4yLu1i/L6ijxgCgtyPx1ONAWrgxr+2jJDiQk=";
      codeModeHostHash = "sha256-pbM/9selATTQiF+78ZTK8c4nRbxXlGRFy2ZBZbBtI1c=";
    };
  };
  source = sources.${stdenv.hostPlatform.system} or (throw "codex is not supported on ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation rec {
  pname = "codex";
  version = "rust-v0.157.0";

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
