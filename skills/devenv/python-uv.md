# Python and uv Configuration

## Basic Python Setup

Enable Python with the latest Python version:

```nix
{
  languages.python = {
    enable = true;
  };
}
```

## uv Integration

### Basic uv Setup

Enable uv package manager:

```nix
{
  languages.python = {
    enable = true;
    uv.enable = true;
  };
}
```

### uv with sync Support

For projects with `pyproject.toml`, enable `uv sync`:

```nix
{
  languages.python = {
    enable = true;
    version = "3.11";
    uv = {
      enable = true;
      sync.enable = true;
    };
  };
}
```

This automatically runs `uv sync` when entering the shell, installing dependencies from `pyproject.toml` and `uv.lock`.

### Advanced uv Configuration

```nix
{
  languages.python = {
    enable = true;
    version = "3.12";
    uv = {
      enable = true;
      sync = {
        enable = true;
        allExtras = true;  # Install all extras
        allGroups = true;  # Install all dependency groups
        # Specific extras/groups:
        # extras = [ "dev" "test" ];
        # groups = [ "dev" ];
      };
    };
  };
}
```

## Python with Virtual Environment (venv)

If not using uv, use traditional venv:

```nix
{
  languages.python = {
    enable = true;
    version = "3.11";
    venv = {
      enable = true;
      requirements = ''
        django>=4.2
        psycopg2-binary
        python-dotenv
      '';
    };
  };
}
```

## Adding System-Level Native Libraries

Some Python packages need native libraries (e.g., PostgreSQL development headers):

```nix
{ pkgs, ... }: {
  languages.python = {
    enable = true;
    version = "3.11";
    libraries = with pkgs; [
      # For psycopg2:
      postgresql
      # For Pillow:
      libjpeg
      zlib
      # For lxml:
      libxml2
      libxslt
    ];
  };
}
```

## Complete Python + uv Example

```nix
{ pkgs, ... }: {
  languages.python = {
    enable = true;
    version = "3.12";
    uv = {
      enable = true;
      sync.enable = true;
    };
    libraries = with pkgs; [
      # Native dependencies
      postgresql
      stdenv.cc.cc.lib
    ];
  };

  # Environment variables
  env.PYTHONUNBUFFERED = "1";
  env.DJANGO_SETTINGS_MODULE = "myproject.settings";

  # Add development packages
  packages = with pkgs; [
    postgresql  # For psql command-line tool
  ];
}
```

## Workflow with uv

1. **Initialize a new project:**
   ```bash
   uv init myproject
   cd myproject
   ```

2. **Add dependencies:**
   ```bash
   uv add django
   uv add psycopg2-binary
   uv add --group dev pytest
   ```

3. **Devenv will auto-sync on shell entry** when `uv.sync.enable = true`

4. **Manual sync if needed:**
   ```bash
   uv sync
   ```

## Troubleshooting

### Issue: uv uses system installation instead of Nix

If you have uv installed globally, devenv might use it. To ensure Nix's uv is used, the skill configuration should handle this automatically. If issues persist, unset any UV environment variables.

### Issue: Native library not found

Add the required library to `languages.python.libraries`. Common libraries:
- PostgreSQL: `postgresql`
- MySQL: `mysql80`
- Image processing: `libjpeg`, `zlib`, `libpng`
- XML: `libxml2`, `libxslt`
