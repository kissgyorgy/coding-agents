# Django Project Setup

# Django Workflow

1. Initialize devenv (if not yet initialized): `devenv init`
2. Configure `devenv.nix` as above
3. Update `devenv.yaml` to use nixpkgs-unstable
4. Enter shell: `devenv shell`
5. Add Django: `uv add django`
6. Create project: `uv run django-admin startproject myproject .`
9. In another terminal: `devenv shell` then `python manage.py migrate`


## Complete Django + PostgreSQL Environment

### Minimal Django Setup

```nix
{ pkgs, ... }: {
  languages.python = {
    enable = true;
    uv = {
      enable = true;
      sync.enable = true;
    };
    libraries = with pkgs; [
      postgresql
    ];
  };

  services.postgres = {
    enable = true;
    initialDatabases = [
      { name = "myproject_dev"; }
    ];
  };

  env = {
    DATABASE_URL = "postgresql://localhost/myproject_dev";
    DJANGO_SETTINGS_MODULE = "myproject.settings";
    PYTHONUNBUFFERED = "1";
  };

  processes = {
    django = {
      exec = "python manage.py runserver";
      process-compose = {
        depends_on = {
          postgres = {
            condition = "process_healthy";
          };
        };
      };
    };
  };
}
```

### 5. Create Django project

If using uv:

```bash
# Initialize uv project (if not done yet)
uv init .

# Add Django and database driver
uv add django psycopg2-binary

# Create Django project
uv run django-admin startproject myproject .
```

Or with traditional venv:

```bash
# Django will be available from venv
django-admin startproject myproject .
```

### 6. Configure Django Database

Edit `myproject/settings.py`:

```python
import os
from pathlib import Path

# Use environment variable for database
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('PGDATABASE', 'myproject_dev'),
        'USER': os.environ.get('PGUSER', os.environ.get('USER')),
        'PASSWORD': os.environ.get('PGPASSWORD', ''),
        'HOST': os.environ.get('PGHOST', ''),
        'PORT': os.environ.get('PGPORT', '5432'),
    }
}
```

This starts both PostgreSQL and Django together.

## Advanced Django Configuration

### Multiple Processes (Django + Celery)

```nix
{ pkgs, ... }: {
  languages.python = {
    enable = true;
    version = "3.12";
    uv = {
      enable = true;
      sync.enable = true;
    };
  };

  services = {
    postgres = {
      enable = true;
      initialDatabases = [{ name = "myapp"; }];
    };
    redis = {
      enable = true;
    };
  };

  processes = {
    django = {
      exec = "python manage.py runserver 0.0.0.0:8000";
      process-compose.depends_on = {
        postgres.condition = "process_healthy";
        redis.condition = "process_healthy";
      };
    };
    celery-worker = {
      exec = "celery -A myproject worker --loglevel=info";
      process-compose.depends_on = {
        postgres.condition = "process_healthy";
        redis.condition = "process_healthy";
      };
    };
    celery-beat = {
      exec = "celery -A myproject beat --loglevel=info";
      process-compose.depends_on = {
        celery-worker.condition = "process_started";
      };
    };
  };
}
```

### Django with Static Files / Tailwind

```nix
{ pkgs, ... }: {
  languages.python = {
    enable = true;
    version = "3.12";
    uv.enable = true;
    uv.sync.enable = true;
  };

  services.postgres = {
    enable = true;
    initialDatabases = [{ name = "myapp"; }];
  };

  # Add Node.js for Tailwind/frontend tools
  packages = with pkgs; [
    nodejs_20
    bun
  ];

  processes = {
    django = {
      exec = "python manage.py runserver";
    };
    tailwind = {
      exec = "bun run dev";  # or python manage.py tailwind start
      cwd = "./frontend";
    };
  };
}
```

## Common Django Packages

Add to `pyproject.toml` or via uv:

```bash
# Core
uv add django

# Admin enhancements
uv add django-debug-toolbar django-extensions

# API
uv add djangorestframework django-cors-headers

# Task queue
uv add celery redis

# Development tools
uv add --group dev pytest pytest-django pytest-sugar

# Static files
uv add whitenoise
```

## Troubleshooting

### PostgreSQL Connection Issues

Ensure environment variables are set:

```bash
echo $PGHOST
echo $PGPORT
echo $PGDATABASE
```

Test connection:

```bash
psql -d myproject_dev
```

### Migration Issues

If migrations fail due to database state:

```bash
# Reset database
devenv processes stop
rm -rf .devenv/state/postgres
devenv up -d

# Re-run migrations
python manage.py migrate
```

### Port Already in Use

Change Django's default port:

```nix
{
  processes.django.exec = "python manage.py runserver 0.0.0.0:8001";
}
```
