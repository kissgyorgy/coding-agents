# Initialize a New Environment

```bash
devenv init
```

This creates:
- `devenv.yaml` - Input configuration
- `devenv.nix` - Environment definition (where you configure everything)
- `.envrc` - direnv integration
- `.gitignore` - Ignores devenv artifacts

Remove comments from .gitignore after init.


## Use nixpkgs-unstable Instead of devenv-rolling

Edit `devenv.yaml` and replace the inputs section:

```yaml
inputs:
  nixpkgs:
    url: github:NixOS/nixpkgs/nixpkgs-unstable
```

This gives access to the latest packages from nixpkgs.

## Update Lock File

After changing inputs:

```bash
devenv update
```

This updates `devenv.lock` with pinned versions.


## Python and uv Setup

Configure in `devenv.nix`:

```nix
{ pkgs, ... }: {
  languages.python = {
    enable = true;
    venv.enable = true;  # uv will use the activated virtualenv
    uv = {
      enable = true;
      sync.enable = true;  # Auto-sync pyproject.toml on shell entry
    };
  };
}
```
