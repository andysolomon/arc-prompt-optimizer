import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);

test("the core (Phase 1 and Phase 2 modules) remains offline and independent of credentials, Pi, and ARC", async () => {
  const coreUrl = new URL("src/core/", rootUrl);
  const coreFiles = (await readdir(coreUrl)).filter((name) => name.endsWith(".ts")).sort();
  const source = (await Promise.all(
    coreFiles.map(async (name) => `${name}\n${await readFile(new URL(name, coreUrl), "utf8")}`),
  )).join("\n");

  for (const [label, forbidden] of [
    ["network API", /\bfetch\s*\(|node:https?|from\s+["']https?/u],
    ["credential access", /process\.env|api[_-]?key|credential|secret[_-]?key/iu],
    ["Pi dependency", /(?:from|import\s*\()\s*["'][^"']*(?:@mariozechner\/pi|arc-pi)/iu],
    ["ARC worker dependency", /(?:from|import\s*\()\s*["'][^"']*arc[_-](?:delegate|runner|worker)/iu],
    ["filesystem persistence", /node:fs|writeFile|appendFile|createWriteStream/iu],
  ]) {
    assert.doesNotMatch(source, forbidden, label);
  }
});

test("fixture labels are not used as a raw quality oracle", async () => {
  const completions = JSON.parse(await readFile(new URL("fixtures/completions.json", rootUrl), "utf8"));
  assert.equal(completions.some(({ text }) => /simulated/iu.test(text)), false);
});

test("package identity, version, and semantic-release script remain preserved", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", rootUrl), "utf8"));
  assert.equal(packageJson.name, "arc-prompt-optimizer");
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/u, "semantic-release owns the version number");
  assert.equal(packageJson.scripts.release, "semantic-release");
});
