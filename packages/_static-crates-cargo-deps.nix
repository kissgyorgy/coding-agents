{ rustPlatform, fetchurl }:

lockFile:
let
  # crates.io's API download endpoint currently returns HTTP 403, while the
  # immutable static crate endpoint remains available.
  fetchStaticCrate = args:
    let
      urlParts = builtins.match "https://crates.io/api/v1/crates/([^/]+)/([^/]+)/download" args.url;
      crateName = builtins.elemAt urlParts 0;
      crateVersion = builtins.elemAt urlParts 1;
    in
    fetchurl (args // {
      url = "https://static.crates.io/crates/${crateName}/${crateName}-${crateVersion}.crate";
    });
in
(rustPlatform.importCargoLock.override {
  fetchurl = fetchStaticCrate;
}) {
  inherit lockFile;
}
