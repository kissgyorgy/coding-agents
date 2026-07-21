export interface BashBlacklistRule {
  name: string;
  regex: RegExp;
  message: string;
}

export interface BashBlacklistConfig {
  messagePrefix: string;
  fileContentWhitelist: Set<string>;
  rules: BashBlacklistRule[];
}

export const config: BashBlacklistConfig = {
  messagePrefix: "Bash command denied.",
  fileContentWhitelist: new Set([
    "[",
    "ack",
    "ag",
    "basename",
    "bat",
    "broot",
    "bzcat",
    "bzgrep",
    "bzip2",
    "cat",
    "ccat",
    "chgrp",
    "chmod",
    "chown",
    "cksum",
    "cmp",
    "comm",
    "cp",
    "csplit",
    "cut",
    "delta",
    "df",
    "diff",
    "dirname",
    "du",
    "ed",
    "egrep",
    "emacs",
    "ex",
    "fd",
    "fgrep",
    "file",
    "find",
    "fmt",
    "fold",
    "git",
    "grep",
    "gunzip",
    "gzcat",
    "gzip",
    "head",
    "hexdump",
    "install",
    "less",
    "ln",
    "ls",
    "md5sum",
    "micro",
    "mkdir",
    "more",
    "mv",
    "nano",
    "nix",
    "nl",
    "nix-store",
    "nvim",
    "od",
    "patch",
    "realpath",
    "readlink",
    "rg",
    "rmdir",
    "rsync",
    "scp",
    "sdiff",
    "sha1sum",
    "sha224sum",
    "sha256sum",
    "sha384sum",
    "sha512sum",
    "shasum",
    "sort",
    "split",
    "stat",
    "strings",
    "sum",
    "tail",
    "tar",
    "tee",
    "test",
    "touch",
    "tree",
    "truncate",
    "uniq",
    "unlink",
    "unzip",
    "vi",
    "vim",
    "wc",
    "xxd",
    "xz",
    "xzcat",
    "zcat",
    "zgrep",
    "zip",
    "zstd",
    "zstdcat",
  ]),
  rules: [
    {
      name: "rm-no-preserve-root",
      regex:
        /(?:^|[;&|\n])\s*(\brm\b[^;&|\n]*\s['"]?--no-preserve-root['"]?(?=\s|$|[;&|\n])[^;&|\n]*)/,
      message:
        "NEVER run rm with --no-preserve-root. Keep root protection enabled, inspect the target first, and ask the user before any risky deletion.",
    },
    {
      name: "rm-recursive",
      regex:
        /(?:^|[;&|\n])\s*(\brm\b[^;&|\n]*(?:\s-(?:[A-Za-z]*[rR][A-Za-z]*|-[A-Za-z-]*recursive\b))[^;&|\n]*)/,
      message:
        "Do not run rm with recursive flags. Inspect the target first and prefer targeted edits or non-recursive cleanup.",
    },
    {
      name: "find-delete",
      regex: /(?:^|[;&|\n])\s*(\bfind\b[^;&|\n]*\s-delete\b[^;&|\n]*)/,
      message:
        "NEVER delete files with find. List matching files first, and only continue with an explicit safer deletion plan.",
    },
    {
      name: "find-exec",
      regex: /(?:^|[;&|\n])\s*(\bfind\b[^;&|\n]*\s-exec\b[^;&|\n]*)/,
      message:
        "NEVER run commands with find. List matching files first and run them one-by-one if there are only a few, " +
        "or write a script (with no find in it!) and run that instead in case of many files.",
    },
    {
      name: "find-ok",
      regex: /(?:^|[;&|\n])\s*(\bfind\b[^;&|\n]*\s-ok\b[^;&|\n]*)/,
      message:
        "NEVER run commands with find. List matching files first and run them one-by-one if there are only a few, " +
        "or write a script (with no find in it!) and run that instead in case of many files.",
    },
    {
      name: "find-root",
      regex:
        /(?:^|[;&|\n])\s*(\bfind\b(?=[^;&|\n]*[\s'"]\/(?:[\s'"]|$|[;&|\n)]))[^;&|\n]*)/,
      message:
        "NEVER run find on large trees like /. " +
        "Limit the search to the project directory or a specific safe subtree, and use a narrower command instead.",
    },
    {
      name: "find-nix",
      regex:
        /(?:^|[;&|\n])\s*(\bfind\b(?=[^;&|\n]*[\s'"]\/nix[^\s'";&|\n)]*)[^;&|\n]*)/,
      message:
        "NEVER run find under /nix. " +
        "Avoid traversing the Nix store; narrow the task to known paths or use project-local search instead.",
    },
    {
      name: "no-sudo",
      regex: /(?:^|[;&|\n])\s*(\bsudo\b[^;&|\n]*)/,
      message: "NEVER run commands as root, ask the user to run it for you.",
    },
  ],
};
