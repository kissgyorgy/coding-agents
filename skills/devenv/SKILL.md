---
name: devenv
description: Use this when any of devenv, service setup, dependencies or Nix packages are mentioned.
---

# devenv.sh Development Environments

Create fast, declarative, reproducible development environments using devenv.sh powered by Nix.
Official docs: https://devenv.sh

For setting up specific programming languages, services, package managers, see:

- **[python-uv.md](python-uv.md)** - Detailed Python/uv configuration
- **[services.md](services.md)** - Complete services configuration guide
- **[django.md](django.md)** - Django project setup and patterns


## Initialize a New Environment

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


## Update Lock File

After changing inputs:

```bash
devenv update
```

This updates `devenv.lock` with pinned versions.

IMPORTANT: ALWAYS run `devenv build` after editing `devenv.nix` to make sure the configuration is working.
Fix any problems that occurs during build.

## Environment Variables

```nix
{
  env = {
    MY_VAR = "value";
    PYTHONUNBUFFERED = "1";
  };
}
```

## Common Commands

- `devenv init` - Initialize new environment
- `devenv shell` - Enter development shell
- `devenv up` - Start services and processes (foreground)
- `devenv up -d` - Start services in background
- `devenv processes stop` - Stop all processes
- `devenv test` - Run tests
- `devenv update` - Update dependencies from devenv.yaml
- `devenv search <pkg>` - Search for packages
- `devenv info` - Show environment info

## File Structure

Key files devenv manages:

- `devenv.nix` - Your environment configuration (commit this)
- `devenv.yaml` - Input sources (commit this)
- `devenv.lock` - Pinned versions (commit this)
- `.envrc` - direnv integration (commit this)
- `.devenv/` - Build artifacts (don't commit)

## Complete Example

```nix
{ pkgs, ... }: {
  # Python with uv
  languages.python = {
    enable = true;
    version = "3.12";
    uv = {
      enable = true;
      sync.enable = true;
    };
    libraries = with pkgs; [ postgresql stdenv.cc.cc.lib ];
  };

  # Services
  services = {
    postgres = {
      enable = true;
      package = pkgs.postgresql_15;
      initialDatabases = [{ name = "app"; }];
    };
    redis.enable = true;
  };

  # Packages
  packages = with pkgs; [
    git
    postgresql
    redis
  ];

  # Environment
  env = {
    DATABASE_URL = "postgresql://localhost/app";
    REDIS_URL = "redis://localhost:6379";
  };

  # Processes
  processes = {
    web = {
      exec = "python manage.py runserver 0.0.0.0:8000";
      process-compose.depends_on = {
        postgres.condition = "process_healthy";
        redis.condition = "process_healthy";
      };
    };
    worker = {
      exec = "celery -A myapp worker";
      process-compose.depends_on = {
        redis.condition = "process_healthy";
      };
    };
  };

  # Scripts
  scripts = {
    migrate = {
      exec = "python manage.py migrate";
      description = "Run migrations";
    };
    test = {
      exec = "pytest";
      description = "Run tests";
    };
  };

  # Enable dotenv
  dotenv.enable = true;
}
```

## Troubleshooting

### Issue: Package not found

Search for it:

```bash
devenv search <package>
```

Ensure using nixpkgs-unstable in `devenv.yaml`.

### Issue: Python package won't install

Add native dependencies to `languages.python.libraries`:

```nix
{
  languages.python.libraries = with pkgs; [
    postgresql  # For psycopg2
    stdenv.cc.cc.lib
  ];
}
```
