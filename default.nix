let
  lock = builtins.fromJSON (builtins.readFile ./flake.lock);
  source = lock.nodes.${lock.nodes.${lock.root}.inputs.flake-compat}.locked;
  flake-compat = builtins.fetchTarball {
    url = "https://github.com/${source.owner}/${source.repo}/archive/${source.rev}.tar.gz";
    sha256 = source.narHash;
  };
in
(import flake-compat { src = ./.; }).outputs
