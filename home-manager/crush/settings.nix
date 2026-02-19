{
  "$schema" = "https://charm.land/crush.json";

  permissions.allowed_tools = [
    "view" "ls" "grep" "edit" "write" "bash" "glob" "fetch"
  ];

  lsp = {
    go = { command = "gopls"; };
    typescript = { command = "typescript-language-server"; args = ["--stdio"]; };
    nix = { command = "nil"; };
    python = { command = "pyright-langserver"; args = ["--stdio"]; };
  };

  options = {
    attribution = {
      trailer_style = "none";
      generated_with = false;
    };
  };
}
