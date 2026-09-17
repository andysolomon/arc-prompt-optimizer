import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const run = promisify(execFile);
const rootPath = fileURLToPath(new URL("../", import.meta.url));

async function readJson(path) {
  return JSON.parse(await readFile(join(rootPath, path), "utf8"));
}

/** Minimal YAML frontmatter reader for single-line `key: value` entries. */
function frontmatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(markdown);
  assert.ok(match, "frontmatter block is present");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const entry = /^([A-Za-z][\w-]*):\s*(.*)$/u.exec(line);
    assert.ok(entry, `frontmatter line is a single-line key: value (${line})`);
    fields[entry[1]] = entry[2].replace(/^"(.*)"$/u, "$1");
  }
  return fields;
}

test("Claude Code plugin manifest has required fields and tracks package.json version", async () => {
  const packageJson = await readJson("package.json");
  const plugin = await readJson(".claude-plugin/plugin.json");
  assert.equal(plugin.name, "arc-prompt-optimizer");
  assert.match(plugin.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "plugin name is kebab-case");
  assert.equal(typeof plugin.description, "string");
  assert.ok(plugin.description.length > 0);
  assert.equal(plugin.version, packageJson.version);
  assert.deepEqual(plugin.author, { name: "andysolomon" });
  assert.equal(plugin.repository, "https://github.com/andysolomon/arc-prompt-optimizer");
});

test("Claude Code marketplace manifest lists the plugin from the repository root", async () => {
  const marketplace = await readJson(".claude-plugin/marketplace.json");
  const plugin = await readJson(".claude-plugin/plugin.json");
  assert.equal(marketplace.name, "arc-prompt-optimizer");
  assert.deepEqual(marketplace.owner, { name: "andysolomon" });
  assert.equal(marketplace.plugins.length, 1);
  const [entry] = marketplace.plugins;
  assert.equal(entry.name, plugin.name);
  assert.equal(entry.source, "./");
  assert.equal(typeof entry.description, "string");
  assert.ok(entry.description.length > 0);
});

test("prompt-optimize skill frontmatter follows the Agent Skills format and loads in Pi", async () => {
  const packageJson = await readJson("package.json");
  const markdown = await readFile(join(rootPath, "skills", "prompt-optimize", "SKILL.md"), "utf8");
  const fields = frontmatter(markdown);
  assert.equal(fields.name, "prompt-optimize", "name matches the skill directory");
  assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  assert.ok(fields.description.length > 0 && fields.description.length <= 1024, "description is 1..1024 characters");
  assert.ok(markdown.split("\n").length <= 160, "SKILL.md stays concise");
  assert.match(markdown, /scripts\/arc-prompt-tools\.mjs candidates/u);
  assert.match(markdown, /scripts\/arc-prompt-tools\.mjs score/u);

  assert.deepEqual(packageJson.pi.skills, ["./skills"]);
  const { skills, diagnostics } = loadSkillsFromDir({ dir: join(rootPath, "skills"), source: "test" });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(skills.map((skill) => skill.name), ["prompt-optimize"]);
  assert.equal(skills[0].description, fields.description);
});

test("the /prompt-optimize plugin command exists and forwards its arguments to the skill", async () => {
  const markdown = await readFile(join(rootPath, "commands", "prompt-optimize.md"), "utf8");
  const fields = frontmatter(markdown);
  assert.ok(fields.description.length > 0);
  assert.ok(fields["argument-hint"].length > 0);
  assert.match(markdown, /\$ARGUMENTS/u);
  assert.match(markdown, /prompt-optimize/u);
});

test("the npm version lifecycle syncs plugin.json for semantic-release", async () => {
  const packageJson = await readJson("package.json");
  const release = await readJson(".releaserc.json");
  assert.equal(packageJson.scripts.version, "node scripts/sync-plugin-version.mjs");
  const gitPlugin = release.plugins.find((entry) => Array.isArray(entry) && entry[0] === "@semantic-release/git");
  assert.ok(gitPlugin[1].assets.includes(".claude-plugin/plugin.json"));

  const dir = await mkdtemp(join(tmpdir(), "arc-plugin-sync-"));
  try {
    await cp(join(rootPath, "scripts", "sync-plugin-version.mjs"), join(dir, "scripts", "sync-plugin-version.mjs"));
    await cp(join(rootPath, ".claude-plugin", "plugin.json"), join(dir, ".claude-plugin", "plugin.json"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "arc-prompt-optimizer", version: "9.8.7" }));
    await run(process.execPath, [join(dir, "scripts", "sync-plugin-version.mjs")], { cwd: dir });
    const synced = JSON.parse(await readFile(join(dir, ".claude-plugin", "plugin.json"), "utf8"));
    assert.equal(synced.version, "9.8.7");
    assert.equal(synced.name, "arc-prompt-optimizer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
