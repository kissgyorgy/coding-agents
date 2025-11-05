# Services Configuration

## Basic configuration

Define processes that run with `devenv up`:

```nix
{ pkgs, ... }: {
  processes = {
    web = {
      exec = "python manage.py runserver";
    };
    worker = {
      exec = "celery -A myapp worker";
    };
  };
}
```

## Set mprocs as service manager TUI

ALWAYS set mprocs as process manager:

```nix
{ pkgs, ... }: {
    process.manager = "mprocs";
}
```
mprocs provides an alternative TUI for process management.


## Service examples

### Basic PostgreSQL Setup

```nix
{ pkgs, ... }: {
  services.postgres.enable = true;
}
```

This starts PostgreSQL with default settings:
- Port: 5432
- Data directory: `$DEVENV_STATE/postgres`
- Unix socket: `$DEVENV_STATE/postgres`

### PostgreSQL with Initial Database

```nix
{ pkgs, ... }: {
  services.postgres = {
    enable = true;
    initialDatabases = [
      { name = "myapp_dev"; }
    ];
  };
}
```


### PostgreSQL with Extensions

```nix
{ pkgs, ... }: {
  services.postgres = {
    enable = true;
    initialDatabases = [
      { name = "mydb"; }
    ];
    extensions = ext: [
      ext.postgis
      ext.timescaledb
      ext.pg_uuidv7
    ];
    settings = {
      shared_preload_libraries = "timescaledb";
    };
    initialScript = ''
      CREATE EXTENSION IF NOT EXISTS timescaledb;
      CREATE EXTENSION IF NOT EXISTS postgis;
    '';
  };
}
```

### PostgreSQL with Initial Schema

```nix
{ pkgs, ... }: {
  services.postgres = {
    enable = true;
    initialDatabases = [
      {
        name = "mydb";
        schema = ./schema.sql;  # Path to SQL file
      }
    ];
  };
}
```

### PostgreSQL with Initialization SQL

```nix
{ pkgs, ... }: {
  services.postgres = {
    enable = true;
    initialDatabases = [
      {
        name = "appdb";
        initialSQL = ''
          CREATE TABLE users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
          );
        '';
      }
    ];
  };
}
```

### PostgreSQL Environment Variables

Devenv automatically sets these environment variables:
- `PGDATA`: Points to the database directory
- `PGHOST`: Points to the socket directory or listen address
- `PGPORT`: The configured port (default 5432)

Access them in your application or scripts:

```bash
# Connect to PostgreSQL
psql -d mydb

# Or with explicit connection string
psql postgresql://localhost:5432/mydb
```

### PostgreSQL Configuration Settings

```nix
{ pkgs, ... }: {
  services.postgres = {
    enable = true;
    settings = {
      max_connections = 100;
      shared_buffers = "128MB";
      log_statement = "all";
      log_destination = "stderr";
      logging_collector = true;
    };
  };
}
```

### PostgreSQL Listen on Network

By default, PostgreSQL only listens on Unix sockets. To listen on network:

```nix
{ pkgs, ... }: {
  services.postgres = {
    enable = true;
    listen_addresses = "127.0.0.1";  # or "0.0.0.0" for all interfaces
    port = 5432;
  };
}
```

## Other Common Services

### Redis

```nix
{ pkgs, ... }: {
  services.redis = {
    enable = true;
    port = 6379;
  };
}
```

### MySQL

```nix
{ pkgs, ... }: {
  services.mysql = {
    enable = true;
    package = pkgs.mysql80;
    initialDatabases = [
      { name = "mydb"; }
    ];
  };
}
```

### MongoDB

```nix
{ pkgs, ... }: {
  services.mongodb.enable = true;
}
```

### Nginx

```nix
{ pkgs, ... }: {
  services.nginx = {
    enable = true;
    httpConfig = ''
      server {
        listen 8080;
        location / {
          proxy_pass http://localhost:8000;
        }
      }
    '';
  };
}
```

### Caddy

```nix
{ pkgs, ... }: {
  services.caddy = {
    enable = true;
    config = ''
      localhost:8080 {
        reverse_proxy localhost:8000
      }
    '';
  };
}
```



## Service State Management

Services store their state in `$DEVENV_STATE/<service-name>`. For example:
- PostgreSQL: `$DEVENV_STATE/postgres`
- Redis: `$DEVENV_STATE/redis`

### Resetting Service State

If you need to reset a service (e.g., after changing `initialScript`):

```bash
# Stop all services
devenv processes stop

# Remove the service state
rm -rf .devenv/state/postgres

# Start services again
devenv up -d
```

## Starting and Stopping Services


```bash
devenv up -d           # Background
devenv processes stop  # stop processes when run in background
```

## Troubleshooting

### Issue: Process won't stop

```bash
devenv processes stop
# If that doesn't work:
pkill -f "devenv"
rm -f .devenv/state/process-compose/*.sock
```

### Issue: Changes to services not taking effect

Service state is cached. Reset it:

```bash
devenv processes stop
rm -rf .devenv/state/postgres
devenv up -d
```
