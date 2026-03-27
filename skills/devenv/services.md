# Services and Processes Configuration (devenv 2.0)

## Basic configuration

Define processes that run with `devenv up`:

```nix
{ pkgs, ... }: {
  processes = {
    web.exec = "python manage.py runserver";
    worker.exec = "celery -A myapp worker";
  };
}
```

devenv 2.0 uses its own **native process manager** by default with a built-in TUI.
Alternative managers (process-compose, mprocs, overmind, etc.) are available but rarely needed:

```nix
{
  process.manager.implementation = "process-compose"; # only if explicitly needed
}
```

## Process Dependencies

Processes can depend on other processes using `after`:

```nix
{
  processes.api = {
    exec = "myapi";
    after = [ "devenv:processes:database" ];  # wait for database to be @ready (default)
  };
}
```

Dependency suffixes for **processes**: `@started`, `@ready` (default), `@completed`
Dependency suffixes for **tasks**: `@started`, `@succeeded` (default), `@completed`

## Ready Probes

devenv 2.0 supports readiness probes that dependencies wait for:

### Exec probe

```nix
{
  processes.database = {
    exec = "postgres -D $PGDATA";
    ready.exec = "pg_isready -d template1";
  };
}
```

### HTTP probe

```nix
{
  processes.api = {
    exec = "myserver";
    ready.http.get = {
      port = 8080;
      path = "/health";
    };
  };
}
```

### Notify probe (systemd-style)

```nix
{
  processes.database = {
    exec = "postgres";
    ready.notify = true;  # process sends READY=1 to $NOTIFY_SOCKET
  };
}
```

### Probe timing options

```nix
{
  processes.api = {
    exec = "myserver";
    ready = {
      http.get = { port = 8080; path = "/health"; };
      initial_delay = 2;     # seconds before first probe (default: 0)
      period = 10;            # seconds between probes (default: 10)
      timeout = 1;            # seconds before probe times out (default: 1)
      success_threshold = 1;  # consecutive successes needed (default: 1)
      failure_threshold = 3;  # consecutive failures before unhealthy (default: 3)
    };
  };
}
```

When `listen` sockets or allocated `ports` are configured and no explicit probe is set,
a TCP connectivity check is used automatically.

## Restart Policies

```nix
{
  processes.worker = {
    exec = "worker --queue jobs";
    restart = {
      on = "on_failure";  # "on_failure" (default), "always", "never"
      max = 5;             # null for unlimited (default: 5)
    };
  };
}
```

## Automatic Port Allocation

devenv 2.0 can auto-allocate free ports to avoid conflicts:

```nix
{ config, ... }: {
  processes.server = {
    ports.http.allocate = 8080;  # starts from 8080, finds next free
    exec = ''
      python -m http.server ${toString config.processes.server.ports.http.value}
    '';
  };
}
```

## File Watching

```nix
{
  processes.backend = {
    exec = "cargo run";
    watch = {
      paths = [ ./src ];
      extensions = [ "rs" "toml" ];
      ignore = [ "target" "*.log" ];
    };
  };
}
```

## Service examples

### Basic PostgreSQL Setup

```nix
{ pkgs, ... }: {
  services.postgres.enable = true;
}
```

This starts PostgreSQL with default settings:

- Port: 5432 (auto-allocated if busy)
- Data directory: `$DEVENV_STATE/postgres`
- Unix socket: `$DEVENV_RUNTIME/postgres`
- Built-in readiness probe using `pg_isready` + `psql`

**IMPORTANT:** Do NOT override `processes.postgres.exec` — the upstream service module
handles initialization, config management, database creation, and readiness probes correctly.
Only use `services.postgres.*` options to configure PostgreSQL.

### PostgreSQL with Initial Databases

```nix
{ pkgs, ... }: {
  services.postgres = {
    enable = true;
    initialDatabases = [
      { name = "myapp_dev"; }
      { name = "myapp_test"; }
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
        schema = ./schema.sql;
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
- `PGPORT`: The configured port (auto-allocated)

```bash
psql -d mydb
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

### PostgreSQL with Database Owner

```nix
{ pkgs, ... }: {
  services.postgres = {
    enable = true;
    initialDatabases = [
      {
        name = "appdb";
        user = "appuser";
        pass = "secret";
      }
    ];
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
devenv processes stop
rm -rf .devenv/state/postgres
devenv up
```

## Starting and Stopping Services

```bash
devenv up              # Foreground with TUI
devenv up -d           # Background (detached)
devenv processes stop  # Stop background processes
devenv processes wait --timeout 120  # Wait for all processes to be ready (CI)
```

## Troubleshooting

### Issue: "not ready: exec" for a service

The readiness probe command is failing. Debug by running the probe manually:

```bash
pg_isready -d template1    # for postgres
```

Common causes:

- PGHOST/PGPORT env vars don't match how postgres was started
- Stale process from a previous session — kill it and restart
- Custom `processes.<service>.exec` override conflicts with the service's readiness probe

**Fix:** Remove any custom `processes.<service>.exec` overrides and use the service's
built-in options instead. devenv 2.0 services handle startup, config, and readiness probes correctly.

### Issue: Process won't stop

```bash
devenv processes stop
# If that doesn't work:
pkill -f "devenv"
```

### Issue: Changes to services not taking effect

Service state is cached. Reset it:

```bash
devenv processes stop
rm -rf .devenv/state/postgres
devenv up
```
