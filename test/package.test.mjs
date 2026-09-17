import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

// `npm test` builds dist/ first, so packing skips the prepack build (and never touches the network).
const run = promisify(execFile);
const rootPath = fileURLToPath(new URL("../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const ALLOWED_TOP_LEVEL = new Set(["bin/arc-prompt", "package.json", "README.md", "CHANGELOG.md", "LICENSE"]);
const FORBIDDEN = /^(?:src|test|docs|fixtures|scripts|node_modules|\.github|\.agents|\.claude)\/|(?:^|\/)\.env|\.tgz$/u;

async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function packJson(args) {
  const { stdout } = await run(npm, ["pack", "--json", "--ignore-scripts", ...args], { cwd: rootPath });
  const [pack] = JSON.parse(stdout);
  return pack;
}

const relative = (path) => path.replace(/^\.\//u, "");

const ALLOWED_PREFIXES = ["dist/", "skills/prompt-optimize/", ".claude-plugin/", "commands/"];

test("the packed tarball ships only the CLI, built dist, skill, plugin manifests, and package metadata", async () => {
  const packageJson = JSON.parse(await readFile(join(rootPath, "package.json"), "utf8"));
  const pack = await packJson(["--dry-run"]);
  const files = pack.files.map((file) => file.path).sort();

  for (const file of files) {
    assert.ok(ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)) || ALLOWED_TOP_LEVEL.has(file), `unexpected packed file ${file}`);
    assert.doesNotMatch(file, FORBIDDEN, `forbidden packed file ${file}`);
  }
  for (const required of [
    "bin/arc-prompt",
    "package.json",
    "README.md",
    "skills/prompt-optimize/SKILL.md",
    "skills/prompt-optimize/scripts/arc-prompt-tools.mjs",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    "commands/prompt-optimize.md",
  ]) {
    assert.ok(files.includes(required), `${required} is packed`);
  }

  const manifestTargets = [
    ...Object.values(packageJson.bin),
    packageJson.main,
    packageJson.types,
    ...Object.values(packageJson.exports).flatMap((entry) => Object.values(entry)),
    ...packageJson.pi.extensions,
  ].map(relative);
  for (const target of manifestTargets) {
    assert.ok(files.includes(target), `manifest target ${target} is packed`);
  }
  assert.deepEqual(packageJson.pi.skills, ["./skills"]);
  for (const skillDir of packageJson.pi.skills.map(relative)) {
    assert.ok(files.some((file) => file.startsWith(`${skillDir}/`) && file.endsWith("/SKILL.md")), `pi skill dir ${skillDir} is packed`);
  }
  assert.equal(files.some((file) => /\.(?:map|d\.ts)$/u.test(file) && !file.startsWith("dist/")), false, "no maps or declarations outside dist");

  assert.equal(packageJson.private, true);
  assert.deepEqual(packageJson.engines, { node: ">=22.19.0" });
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
  ]);
});

test("a clean extract of the tarball runs the CLI offline and loads only /prompt-optimize in Pi", async () => {
  await withTempDir("arc-prompt-pack-", async (packDir) => {
    const pack = await packJson(["--pack-destination", packDir]);
    await run("tar", ["-xzf", join(packDir, pack.filename), "-C", packDir]);
    const packageDir = await realpath(join(packDir, "package"));
    // Reuse this checkout's installed dependencies instead of a network install.
    await symlink(join(rootPath, "node_modules"), join(packageDir, "node_modules"), "dir");

    const patterns = await run(process.execPath, [join(packageDir, "bin", "arc-prompt"), "patterns", "--json"], {
      cwd: packDir,
    });
    assert.ok(JSON.parse(patterns.stdout).patterns.some((pattern) => pattern.name === "critique"));
    const models = await run(process.execPath, [join(packageDir, "bin", "arc-prompt"), "models", "--simulate", "--json"], {
      cwd: packDir,
    });
    assert.deepEqual(JSON.parse(models.stdout).models.map((model) => model.canonical), ["simulate/balanced", "simulate/fast"]);

    await withTempDir("arc-prompt-pack-agent-", async (agentDir) => {
      const result = await discoverAndLoadExtensions([packageDir], agentDir, agentDir);
      assert.deepEqual(result.errors, []);
      assert.equal(result.extensions.length, 1);
      const [extension] = result.extensions;
      assert.ok((await realpath(extension.path)).startsWith(packageDir), `loaded from the extracted package: ${extension.path}`);
      assert.deepEqual([...extension.commands.keys()], ["prompt-optimize"]);
      assert.equal(extension.tools.size + extension.handlers.size + extension.shortcuts.size + extension.flags.size, 0);
    });
  });
});
