## Troubleshooting

### Issue: Package not found

Search for it:

```bash
devenv search <package>
```

### Issue: Python virtualenv is not activated

For Python projects using uv, set both `languages.python.uv.sync.enable = true`
and `languages.python.venv.enable = true`. `uv.sync` installs dependencies;
`venv.enable` activates the virtualenv so `python` and console scripts come from
the project environment.

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
