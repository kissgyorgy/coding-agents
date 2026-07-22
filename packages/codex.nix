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
      hash = "sha256-v68Tybo08q12TkqRbEnPcXeuujKc8PcZ4iJ1ZvyNZio=";
      codeModeHostHash = "sha256-rCMXeVbDDMH58YDCe9gPW7W3Z4DbVfuU3MImRNSQhS4=";
    };
    aarch64-darwin = {
      target = "aarch64-apple-darwin";
      hash = "sha256-Byowpl8FZmc1iJ7w9gtW2xhq293p1cXMGmS+C1mFMP4=";
      codeModeHostHash = "sha256-dfkwaDSqiRO1wfkf9y8fa5RB5aks1dZLjmBc9UZoRgw=";
    };
  };
  source = sources.${stdenv.hostPlatform.system} or (throw "codex is not supported on ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation rec {
  pname = "codex";
  version = "rust-v0.145.0";

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
