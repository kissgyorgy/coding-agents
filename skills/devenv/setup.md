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


## Adding Nix Packages

Add system packages to your environment:

```nix
{ pkgs, ... }: {
  packages = with pkgs; [
    just        # always add this
    postgresql  # For psql CLI
    redis       # For redis-cli
  ];
}
```

Search for packages:

```bash
devenv search <package-name>
```

Only works after `devenv init`

## Set up git-hooks

Add the git-hooks input: `devenv inputs add git-hooks github:cachix/git-hooks.nix`
After that, `devenv.yaml` should contain the git-hooks input:
```yaml
inputs:
  git-hooks:
    url: github:cachix/git-hooks.nix
```

Always add these common hooks to `devenv.nix`:

```nix
  git-hooks.hooks = {
    check-added-large-files.enable = true;
    check-json.enable = true;
    check-toml.enable = true;
    check-yaml.enable = true;
    trim-trailing-whitespace = {
      enable = true;
      excludes = [ ".*.md$" ];
    };
    end-of-file-fixer.enable = true;
  }
```

Add ruff hooks for Python projects only:
```nix
  git-hooks.hooks = {
    ruff = {
      enable = true;
      args = [ "--config" "${rootDir}/pyproject.toml"];
    };
    ruff-format.enable = true;
  }
```

## Update Lock File

After changing inputs:

```bash
devenv update
```

This updates `devenv.lock` with pinned versions.
