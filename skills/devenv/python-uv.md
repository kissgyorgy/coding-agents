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

For Python projects using uv, enable both `uv.sync.enable` and `venv.enable`.
`uv.sync.enable` installs dependencies from `pyproject.toml` / `uv.lock`, while
`venv.enable` activates that virtual environment in `devenv shell` / direnv
(`VIRTUAL_ENV` is set and the venv `bin` directory is added to `PATH`).

### Basic uv Setup

Enable uv package manager:

```nix
{
  languages.python = {
    enable = true;
    uv.enable = true;
    venv.enable = true;
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
    venv.enable = true;
  };
}
```

This automatically runs `uv sync` when entering the shell, installing dependencies from `pyproject.toml` and `uv.lock`, and activates the resulting virtual environment.

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
        extras = [ "dev" "test" ];
        groups = [ "dev" ];
      };
    };
    venv.enable = true;
  };
}
```

## Adding System-Level Native Libraries

Some Python packages need native libraries (e.g., PostgreSQL development
headers, Pillow image libraries, etc.):

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

4. **Devenv will activate the virtual environment** when `venv.enable = true`,
   so bare commands like `python`, `django-admin`, and console scripts use
   project dependencies.

5. **Manual sync if needed:**
   ```bash
   uv sync
   ```

## Troubleshooting

### Issue: Native library not found

Add the required library to `languages.python.libraries`. Common libraries:

- PostgreSQL: `postgresql`
- MySQL: `mysql80`
- Image processing: `libjpeg`, `zlib`, `libpng`
- XML: `libxml2`, `libxslt`
