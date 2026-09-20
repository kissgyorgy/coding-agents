#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
  const [lockPathArgument] = process.argv.slice(2);
  if (!lockPathArgument) {
    throw new Error("Usage: fill-pi-lock-integrities.mjs <package-lock.json>");
  }

  const lockPath = resolve(lockPathArgument);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (typeof lock.packages !== "object" || lock.packages === null) {
    throw new Error(`Invalid npm lockfile: ${lockPath}`);
  }

  let changed = false;
  for (const [packagePath, metadata] of Object.entries(lock.packages)) {
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      metadata.integrity !== undefined ||
      typeof metadata.resolved !== "string" ||
      !metadata.resolved.startsWith("https://registry.npmjs.org/")
    ) {
      continue;
    }

    const response = await fetch(metadata.resolved);
    if (!response.ok) {
      throw new Error(
        `Could not fetch ${packagePath}: ${response.status} ${response.statusText}`,
      );
    }

    const archive = Buffer.from(await response.arrayBuffer());
    metadata.integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    changed = true;
    console.log(`Added integrity for ${packagePath}`);
  }

  if (changed) {
    await writeFile(lockPath, `${JSON.stringify(lock, null, "\t")}\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
