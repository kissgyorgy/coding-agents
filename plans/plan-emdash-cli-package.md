# Overview

Package emdash (agent orchestration tool) as a Nix derivation using the AppImage approach, identical to the existing Maestro package.

# Architecture

Fetch the `emdash-x64.AppImage` from GitHub releases, extract it with `appimageTools.extractType2`, wrap with `appimageTools.wrapType2`, and add a shell wrapper for Wayland/Ozone flags. Register in `overlay.nix` and add to the user's home packages.

# Implementation plan

Follow the exact same pattern as `packages/maestro.nix`:

1. **`packages/emdash.nix`** — New file using `appimageTools` to:
   - `fetchurl` the AppImage from `https://github.com/generalaction/emdash/releases/download/v0.4.18/emdash-x64.AppImage`
   - Extract with `appimageTools.extractType2`
   - Wrap with `appimageTools.wrapType2`, installing `.desktop` and icon files from extracted contents
   - Create a shell wrapper with `--enable-features=UseOzonePlatform --ozone-platform=wayland`
   - Combine via `symlinkJoin`
   - The `.desktop` file and icon names need to be discovered after first build attempt (may be `emdash.desktop` and `emdash.png` based on convention)

2. **`overlay.nix`** — Add entry:

   ```nix
   emdash = super.callPackage ./packages/emdash.nix { };
   ```

3. **`desktop.nix`** — Add `emdash` to user packages.

### Hash discovery

The `fetchurl` hash and the exact desktop/icon filenames inside the AppImage are unknown until first build. Steps:

- Use `nix-prefetch-url` to get the hash for the AppImage URL
- Build once to inspect `appimageContents` for the `.desktop` file and icon path
- If the desktop/icon install commands fail, adjust filenames accordingly

# Files to modify

1. **`packages/emdash.nix`** (new) — AppImage package derivation, modeled after `maestro.nix`:

   ```nix
   { lib, appimageTools, fetchurl, writeShellScriptBin, symlinkJoin }:
   let
     pname = "emdash";
     version = "0.4.18";
     src = fetchurl {
       url = "https://github.com/generalaction/emdash/releases/download/v${version}/emdash-x64.AppImage";
       hash = ""; # to be filled via nix-prefetch-url
     };
     # ... same pattern as maestro.nix
   ```

2. **`overlay.nix`** — Add `emdash = super.callPackage ./packages/emdash.nix { };`

3. **Home packages file** — Add `pkgs.emdash` to the packages list (find the right file first)

4. **`Justfile`** — Add `"emdash"` to the `update-packages` recipe so `just update-packages` and `just update-package emdash` both work. `nix-update` handles this automatically since the package uses `fetchurl` with `v${version}` in the GitHub releases URL.

   ```
   update-packages: \
       (update-package "emdash") \
       (update-package "fossflow") \
       ...
   ```

# Verification, success criteria

1. Run `nix-prefetch-url https://github.com/generalaction/emdash/releases/download/v0.4.18/emdash-x64.AppImage` to get the hash
2. Run `just build-package emdash` — should build successfully
3. Inspect the built result to confirm the binary and desktop file exist
4. Optionally run the binary to confirm it launches

# Todo items

1. Prefetch the AppImage URL hash with `nix-prefetch-url`
2. Create `packages/emdash.nix` following maestro.nix pattern
3. Add emdash to `overlay.nix`
4. Add emdash to user's home packages
5. Add `emdash` to the `update-packages` recipe in Justfile
6. Build with `just build-package emdash` and fix any issues (desktop/icon filenames)
7. Commit
