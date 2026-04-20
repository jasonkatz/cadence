#!/usr/bin/env node
/**
 * Workaround for an upstream bug in `@workflow/world-local@5.0.0-beta.2`:
 * its bundled-context fallback sets `version: 'bundled'`, but `parseVersion`
 * throws on that string because it isn't semver. As a result, `world.start()`
 * crashes inside `bun build --compile` binaries where package.json isn't
 * reachable from `import.meta.url`.
 *
 * We patch `init.js` to hardcode the real version (read from the installed
 * package.json) in the fallback, so the bundled daemon boots cleanly.
 * Idempotent: detects the marker and skips if already applied.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, "..");
const pkgJsonPath = path.join(
  serverDir,
  "node_modules",
  "@workflow",
  "world-local",
  "package.json"
);
const initJsPath = path.join(
  serverDir,
  "node_modules",
  "@workflow",
  "world-local",
  "dist",
  "init.js"
);

if (!existsSync(pkgJsonPath) || !existsSync(initJsPath)) {
  console.error(
    `[patch-wdk] @workflow/world-local not installed; skipping (expected ${pkgJsonPath})`
  );
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
const realVersion = pkg.version;
if (!/^\d+\.\d+\.\d+(?:-.+)?$/.test(realVersion)) {
  console.error(
    `[patch-wdk] installed @workflow/world-local has non-semver version "${realVersion}"; aborting`
  );
  process.exit(1);
}

const marker = "// patched-for-bun-compile";
const current = readFileSync(initJsPath, "utf-8");
if (current.includes(marker)) {
  console.log(`[patch-wdk] init.js already patched (${realVersion})`);
  process.exit(0);
}

const needle = `version: 'bundled',`;
if (!current.includes(needle)) {
  console.error(
    `[patch-wdk] could not find expected fallback "${needle}" in init.js — WDK shape changed; aborting`
  );
  process.exit(1);
}

const patched = current.replace(
  needle,
  `version: '${realVersion}', ${marker}`
);
writeFileSync(initJsPath, patched);
console.log(
  `[patch-wdk] patched @workflow/world-local init.js: bundled fallback version -> ${realVersion}`
);
