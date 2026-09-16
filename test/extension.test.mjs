import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import arcPromptOptimizerExtension, {
  PROMPT_OPTIMIZE_COMMAND,
  PromptOptimizeUnsupportedModeError,
  handlePromptOptimize,
  promptOptimizeModeSupport,
} from "../dist/extension/index.js";

const rootUrl = new URL("../", import.meta.url);

function fakeContext(mode, hasUI) {
  const notifications = [];
  return {
    notifications,
    ctx: { mode, hasUI, ui: { notify: (message, level) => notifications.push({ message, level }) } },
  };
}

test("package manifest declares a Pi package whose extension entrypoint is built", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", rootUrl), "utf8"));
  assert.ok(packageJson.keywords.includes("pi-package"));
  assert.deepEqual(packageJson.pi, { extensions: ["./dist/extension/index.js"] });
  assert.equal(packageJson.exports["./extension"].import, "./dist/extension/index.js");
  assert.ok(packageJson.files.includes("dist/**"));
  assert.ok((await stat(new URL("dist/extension/index.js", rootUrl))).isFile());
});

test("Pi's extension loader registers only the /prompt-optimize command from the package", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "arc-prompt-pi-agent-"));
  try {
    const result = await discoverAndLoadExtensions([new URL(".", rootUrl).pathname], agentDir, agentDir);
    assert.deepEqual(result.errors, []);
    const extension = result.extensions.find(({ path }) => path.endsWith(join("dist", "extension", "index.js")));
    assert.ok(extension, "package extension was loaded");
    assert.deepEqual([...extension.commands.keys()], [PROMPT_OPTIMIZE_COMMAND]);
    assert.equal(extension.tools.size, 0);
    assert.equal(extension.handlers.size, 0);
    assert.equal(extension.shortcuts.size, 0);
    assert.equal(extension.flags.size, 0);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("the factory registers an explicit command with a description", () => {
  const registered = [];
  arcPromptOptimizerExtension({ registerCommand: (name, options) => registered.push({ name, options }) });
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "prompt-optimize");
  assert.match(registered[0].options.description, /without submitting/u);
  assert.equal(typeof registered[0].options.handler, "function");
});

test("mode support allows only the interactive TUI", () => {
  assert.deepEqual(promptOptimizeModeSupport("tui"), { supported: true });
  for (const mode of ["rpc", "json", "print"]) {
    const support = promptOptimizeModeSupport(mode);
    assert.equal(support.supported, false);
    assert.match(support.reason, /requires the interactive TUI/u);
  }
});

test("RPC mode reports the unsupported mode through the host UI", async () => {
  const { ctx, notifications } = fakeContext("rpc", true);
  await handlePromptOptimize("", ctx);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "error");
  assert.match(notifications[0].message, /RPC mode/u);
});

test("print and JSON modes throw instead of prompting invisibly", async () => {
  for (const mode of ["print", "json"]) {
    const { ctx, notifications } = fakeContext(mode, false);
    await assert.rejects(handlePromptOptimize("draft", ctx), (error) => {
      assert.ok(error instanceof PromptOptimizeUnsupportedModeError);
      assert.equal(error.mode, mode);
      assert.match(error.message, /arc-prompt CLI/u);
      return true;
    });
    assert.deepEqual(notifications, []);
  }
});

test("TUI mode reports that the review workflow is not available yet", async () => {
  const { ctx, notifications } = fakeContext("tui", true);
  await handlePromptOptimize("draft", ctx);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "warning");
});

test("the extension stays isolated from the CLI, credentials, persistence, and prompt interception", async () => {
  const extensionUrl = new URL("src/extension/", rootUrl);
  const files = (await readdir(extensionUrl)).filter((name) => name.endsWith(".ts")).sort();
  const source = (await Promise.all(
    files.map(async (name) => `${name}\n${await readFile(new URL(name, extensionUrl), "utf8")}`),
  )).join("\n");

  for (const [label, forbidden] of [
    ["CLI dependency", /from\s+["']\.\.\/cli\//u],
    ["credential access", /process\.env|api[_-]?key|getProviderAuth/iu],
    ["filesystem persistence", /node:fs|writeFile|appendFile|createWriteStream/iu],
    ["session persistence", /appendEntry|setSessionName|setLabel/u],
    ["automatic submission", /sendUserMessage|sendMessage/u],
    ["input interception", /\.on\(\s*["'](?:input|before_agent_start|context|before_provider_request)["']/u],
    ["model-callable tool", /registerTool/u],
    ["active model mutation", /setModel|setThinkingLevel/u],
  ]) {
    assert.doesNotMatch(source, forbidden, label);
  }
});
