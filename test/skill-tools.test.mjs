import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../dist/cli/main.js";
import { buildSkillTools } from "../scripts/build-skill-tools.mjs";

/** Runs a command with stdin closed, as the skill instructs (`</dev/null`): the tools read stdin when it is not a TTY. */
function run(file, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(file, args, { ...options, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolvePromise({ stdout, stderr });
    });
    child.stdin.end();
  });
}
const rootPath = fileURLToPath(new URL("../", import.meta.url));
const skillPath = join(rootPath, "skills", "prompt-optimize");
const toolsPath = join(skillPath, "scripts");

async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}

class Capture {
  constructor() {
    this.text = "";
  }

  write(chunk, callback) {
    this.text += chunk;
    callback?.();
    return true;
  }

}

async function arcPrompt(argv) {
  const stdout = new Capture();
  const stderr = new Capture();
  const stdin = { isTTY: true, setEncoding() {}, on() { return this; } };
  const exitCode = await runCli({ argv, io: { stdin, stdout, stderr, cwd: rootPath } });
  return { exitCode, stdout: stdout.text, stderr: stderr.text };
}

test("committed skill tool files are byte-identical to a fresh build (drift check)", async () => {
  await withTempDir("arc-skill-tools-build-", async (outDir) => {
    const built = await buildSkillTools(outDir);
    const fresh = await listFiles(outDir);
    const committed = await listFiles(toolsPath);
    assert.deepEqual(committed, fresh, "run `npm run build` and commit skills/prompt-optimize/scripts");
    assert.deepEqual([...built].sort(), fresh);
    for (const file of fresh) {
      assert.ok(
        (await readFile(join(toolsPath, file))).equals(await readFile(join(outDir, file))),
        `${file} drifted; run \`npm run build\` and commit skills/prompt-optimize/scripts`,
      );
    }
  });
});

test("skill tool bundle is dependency-free ESM without maps or declarations", async () => {
  const files = await listFiles(toolsPath);
  assert.ok(files.includes("arc-prompt-tools.mjs"));
  for (const file of files) {
    assert.match(file, /\.mjs$/u, `${file} is an .mjs module`);
    const source = await readFile(join(toolsPath, file), "utf8");
    assert.doesNotMatch(source, /sourceMappingURL/u, `${file} has no source map reference`);
    const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/gu)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.ok(specifier.startsWith("node:") || specifier.startsWith("./") || specifier.startsWith("../"), `${file} imports ${specifier}`);
      assert.doesNotMatch(specifier, /@earendil-works|pi-completion|extension/u, `${file} imports ${specifier}`);
    }
  }
});

test("the skill tool runs from a copy outside the repo with no node_modules and matches arc-prompt", async () => {
  await withTempDir("arc-skill-tools-run-", async (dir) => {
    await cp(skillPath, join(dir, "prompt-optimize"), { recursive: true });
    const entry = join(dir, "prompt-optimize", "scripts", "arc-prompt-tools.mjs");
    const work = join(dir, "work");
    await mkdir(work);
    const prompt = "Summarize the release notes for a changelog.";
    await writeFile(join(work, "prompt.txt"), prompt);

    const candidates = await run(process.execPath, [entry, "candidates", "--prompt-file", "prompt.txt", "--json"], { cwd: work });
    const expectedCandidates = await arcPrompt(["candidates", "--prompt", prompt, "--json"]);
    assert.equal(candidates.stdout, expectedCandidates.stdout);
    const parsed = JSON.parse(candidates.stdout);
    assert.deepEqual(parsed.candidates.map((candidate) => candidate.pattern), ["baseline", "critique", "decomposition", "chain_of_thought"]);

    const outputs = {
      candidates: parsed.candidates.map((candidate, index) => ({
        id: candidate.id,
        prompt: candidate.prompt,
        outputs: { preview: index === 1 ? "" : `output ${index}` },
      })),
    };
    await writeFile(join(work, "outputs.json"), JSON.stringify(outputs));
    const score = await run(process.execPath, [entry, "score", "--outputs", "outputs.json", "--json"], { cwd: work });
    const expectedScore = await arcPrompt(["score", "--outputs", join(work, "outputs.json"), "--json"]);
    assert.equal(score.stdout, expectedScore.stdout);
    const ranking = JSON.parse(score.stdout).ranking;
    assert.equal(ranking.at(-1).candidateId, parsed.candidates[1].id);

    const help = await run(process.execPath, [entry, "score", "--help"], { cwd: work });
    assert.equal(help.stdout, (await arcPrompt(["score", "--help"])).stdout);

    await assert.rejects(run(process.execPath, [entry, "optimize", "--simulate"], { cwd: work }), (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Supported commands: candidates, score/u);
      return true;
    });
  });
});
