---
name: devenv
description: Use this when working in a project with devenv.nix, or when devenv.sh development environment setup, services, dependencies, or Nix packages are relevant.
---

# devenv.sh Development Environments

Create fast, declarative, reproducible development environments using devenv.sh powered by Nix.

For setting up specific programming languages, services, package managers, see:
- [Initialize a new project](setup.md) - For new projects or when no devenv.nix exists or the user asks for devenv setup.
- [Detailed Python/uv configuration](python-uv.md)
- [Complete services configuration guide](services.md)
- [Django project setup and patterns](django.md)
- [Troubleshooting devenv issues](troubleshooting.md)

Official documentation: https://devenv.sh
Only look this up for specific settings or when you need something which is not included in this skill.

## Common Commands

- `devenv init` - Initialize new environment
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
{ pkgs, config, ... }: {
  # Python with uv
  languages.python = {
    enable = true;
    version = "3.12";
    uv = {
      enable = true;
      sync.enable = true;
    };
    venv.enable = true;  # Activate the synced virtualenv in shell/direnv
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

  # Environment variables
  env = {
    DATABASE_URL = "postgresql://localhost/app";
    REDIS_URL = "redis://localhost:6379";
  };

  # Processes (devenv 2.0 native process manager with dependency support)
  processes = {
    web = {
      exec = "python manage.py runserver 0.0.0.0:8000";
      after = [ "devenv:processes:postgres" "devenv:processes:redis" ];
    };
    worker = {
      exec = "celery -A myapp worker";
      after = [ "devenv:processes:redis" ];
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

ALWAYS run `devenv build` after editing `devenv.nix` to make sure the
configuration is working. Fix any problems that occurs during build.
