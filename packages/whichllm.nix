{ lib
, python3Packages
, fetchPypi
, versionCheckHook
,
}:

let
  dbgpu = python3Packages.buildPythonPackage rec {
    pname = "dbgpu";
    version = "2025.12";
    format = "setuptools";

    src = fetchPypi {
      inherit pname version;
      hash = "sha256-1KL9w2/1/yrzfo/Yo+B0CrKvc8xeD9oZn9/z1vFob04=";
    };

    propagatedBuildInputs = with python3Packages; [
      click
      pydantic
      thefuzz
    ];

    pythonImportsCheck = [ "dbgpu" ];

    meta = {
      description = "Small database of GPUs with architecture, API support, and performance details";
      homepage = "https://github.com/painebenjamin/dbgpu";
      license = lib.licenses.mit;
      maintainers = [ ];
    };
  };
in
python3Packages.buildPythonApplication rec {
  pname = "whichllm";
  version = "0.5.3";
  format = "pyproject";

  src = fetchPypi {
    inherit pname version;
    hash = "sha256-6Z13Iqj9cdFiWfzidqPABt4Y5y/4VZsmeBNWxTMSj6k=";
  };

  nativeBuildInputs = [
    python3Packages.hatchling
  ];

  propagatedBuildInputs = with python3Packages; [
    dbgpu
    httpx
    nvidia-ml-py
    psutil
    rich
    typer
  ];


  pythonImportsCheck = [
    "whichllm"
    "whichllm.cli"
  ];

  nativeInstallCheckInputs = [ versionCheckHook ];
  doInstallCheck = true;
  versionCheckProgramArg = "--version";

  meta = {
    description = "Find the best local LLM that runs on your hardware";
    homepage = "https://github.com/Andyyyy64/whichllm";
    changelog = "https://github.com/Andyyyy64/whichllm/releases/tag/v${version}";
    license = lib.licenses.mit;
    maintainers = [ ];
    mainProgram = "whichllm";
  };
}
