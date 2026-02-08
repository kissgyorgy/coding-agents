{ pkgs, config, ... }:
with config.lib;
{
  home.file = {
    ".pi/agent/extensions".source = file.mkOutOfStoreSymlink "/home/walkman/nixconf/home/pi-coding-agent/extensions";
  };

  home.packages = with pkgs; [
    pi-coding-agent
  ];
}
