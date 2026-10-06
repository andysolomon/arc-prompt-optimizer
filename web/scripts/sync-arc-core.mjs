#!/usr/bin/env node
/**
 * Copies the model-free core of arc-prompt-optimizer (src/core/* and the provider-neutral
 * adapters/completion.ts) into lib/arc-core unchanged, or verifies with --check that the copies
 * are byte-identical to the repository source. The Pi adapter is intentionally excluded because it
 * pulls the whole Pi coding agent into the server bundle.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "..");
const sourceRoot = join(repoRoot, "src");
const targetRoot = join(webRoot, "lib", "arc-core");
const check = process.argv.includes("--check");

const files = [
  ...readdirSync(join(sourceRoot, "core"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join("core", name)),
  join("adapters", "completion.ts"),
];

if (!existsSync(join(sourceRoot, "core", "index.ts"))) {
  console.error(`arc-core sync: repository source not found at ${sourceRoot}`);
  process.exit(check ? 0 : 1);
}

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
let drift = 0;
for (const file of files) {
  const source = readFileSync(join(sourceRoot, file));
  const target = join(targetRoot, file);
  if (check) {
    const current = existsSync(target) ? readFileSync(target) : Buffer.alloc(0);
    if (sha(current) !== sha(source)) {
      drift += 1;
      console.error(`arc-core sync: ${relative(webRoot, target)} differs from ${relative(webRoot, join(sourceRoot, file))}`);
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
}

if (check) {
  if (drift > 0) {
    console.error(`arc-core sync: ${drift} file(s) drifted. Run \`pnpm sync:arc-core\`.`);
    process.exit(1);
  }
  console.log(`arc-core sync: ${files.length} files match the repository source.`);
} else {
  console.log(`arc-core sync: copied ${files.length} files into lib/arc-core.`);
}
