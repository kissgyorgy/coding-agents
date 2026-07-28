#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REFRESH_TIMEOUT_MS = 15_000;

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`));
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

async function loadGeneratedCatalog(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid generated model catalog: ${path}`);
  }
  return value;
}

async function startCatalogServer(catalog, lastModified) {
  const responses = new Map(
    Object.entries(catalog).map(([providerId, models]) => [
      providerId,
      JSON.stringify(models),
    ]),
  );

  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }

    let providerId;
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const match = /^\/api\/models\/providers\/([^/]+)$/.exec(pathname);
      providerId = match ? decodeURIComponent(match[1]) : undefined;
    } catch {
      response.writeHead(400).end();
      return;
    }

    const body =
      providerId === undefined ? undefined : responses.get(providerId);
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Last-Modified": lastModified.toUTCString(),
    });
    response.end(body);
  });

  await new Promise((resolvePromise, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolvePromise();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not determine local model catalog server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      }),
  };
}

async function main() {
  const [piSourceArgument, piPackageArgument] = process.argv.slice(2);
  if (!piSourceArgument || !piPackageArgument) {
    throw new Error("Usage: update-pi-models.mjs <pi-source> <pi-package>");
  }

  const piSource = resolve(piSourceArgument);
  const piPackage = resolve(piPackageArgument);
  const packageDir = join(piPackage, "lib", "pi-coding-agent");
  const temporaryDir = await mkdtemp(join(tmpdir(), "pi-model-catalog-"));
  const catalogDir = join(temporaryDir, "catalog");

  try {
    await run(process.execPath, [
      join(piSource, "packages", "ai", "scripts", "generate-models.ts"),
      "--strict",
      "--json-only",
      "--json-output",
      catalogDir,
    ]);

    const catalog = await loadGeneratedCatalog(join(catalogDir, "models.json"));
    const [{ ModelRuntime, getAgentDir }, { getBuiltinModelDataGeneratedAt }] =
      await Promise.all([
        import(pathToFileURL(join(packageDir, "dist", "index.js")).href),
        import(
          pathToFileURL(
            join(
              packageDir,
              "node_modules",
              "@earendil-works",
              "pi-ai",
              "dist",
              "providers",
              "all.js",
            ),
          ).href
        ),
      ]);

    const builtinGeneratedAt = getBuiltinModelDataGeneratedAt() ?? 0;
    const lastModified = new Date(
      Math.max(Date.now(), builtinGeneratedAt + 1_000),
    );
    const catalogServer = await startCatalogServer(catalog, lastModified);

    try {
      const agentDir = getAgentDir();
      await mkdir(agentDir, { recursive: true });
      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
        allowModelNetwork: false,
        catalogBaseUrl: catalogServer.baseUrl,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
      try {
        const result = await modelRuntime.refresh({
          allowNetwork: true,
          force: true,
          signal: controller.signal,
        });
        if (result.aborted) {
          throw new Error("Model catalog refresh timed out");
        }
        if (result.errors.size > 0) {
          const details = Array.from(
            result.errors,
            ([provider, error]) => `${provider}: ${error.message}`,
          ).join("; ");
          throw new Error(`Could not refresh model catalogs: ${details}`);
        }
      } finally {
        clearTimeout(timeout);
      }

      console.log(
        `Model catalogs written to ${join(agentDir, "models-store.json")}`,
      );
    } finally {
      await catalogServer.close();
    }
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
