{ rustPlatform, fetchurl }:

lockFile:
let
  # crates.io's API download endpoint currently returns HTTP 403, while the
  # immutable static crate endpoint remains available.
  fetchStaticCrate = args:
    let
      urlParts = builtins.match "https://crates.io/api/v1/crates/([^/]+)/([^/]+)/download" args.url;
      staticArgs =
        if urlParts == null then
          args
        else
          let
            crateName = builtins.elemAt urlParts 0;
            crateVersion = builtins.elemAt urlParts 1;
          in
          args // {
            url = "https://static.crates.io/crates/${crateName}/${crateName}-${crateVersion}.crate";
          };
    in
    fetchurl staticArgs;
in
(rustPlatform.importCargoLock.override {
  fetchurl = fetchStaticCrate;
}) {
  inherit lockFile;
}
