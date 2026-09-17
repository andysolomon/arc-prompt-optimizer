#!/usr/bin/env node
// Opt-in ARC Pi integration check (not part of `npm test`).
// Loads this package's built extension with ARC Pi's own Pi runtime and drives /prompt-optimize
// end to end with an in-memory fake provider: no network, no real providers, no paid workers.
// Usage: ARC_PI_DIR=/path/to/arc-pi npm run verify:arc-pi   (defaults to ../arc-pi when present)
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const arcPiDir = resolve(process.env.ARC_PI_DIR ?? join(repoRoot, "..", "arc-pi"));
const piPackageDir = join(arcPiDir, "node_modules", "@earendil-works", "pi-coding-agent");
if (!existsSync(join(piPackageDir, "package.json"))) {
  process.stderr.write(
    `verify:arc-pi: no ARC Pi checkout with installed Pi at ${arcPiDir}. Set ARC_PI_DIR to an arc-pi checkout with node_modules.\n`,
  );
  process.exit(2);
}

const FAKE_PROVIDER = "arc-verify-fake";
const FAKE_KEY = "arc-verify-fake-not-a-credential";
const COMMAND = "prompt-optimize";
const CREDENTIAL_FILE = /auth\.json$|credential|\.pem$|\.key$|token/iu;

async function snapshotDir(dir) {
  if (!existsSync(dir)) return { exists: false, entries: {} };
  const entries = {};
  for (const name of (await readdir(dir)).sort()) {
    const info = await stat(join(dir, name));
    entries[name] = `${info.isDirectory() ? "d" : "f"}:${info.size}:${info.mtimeMs}`;
  }
  return { exists: true, mtimeMs: (await stat(dir)).mtimeMs, entries };
}

async function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(join(dir, entry.name), relative)));
    else files.push(relative);
  }
  return files.sort();
}

const realArcPiHome = resolve(process.env.ARC_PI_HOME ?? join(homedir(), ".arc-pi"));
const realBefore = await snapshotDir(realArcPiHome);
const profileDir = await mkdtemp(join(tmpdir(), "arc-prompt-verify-profile-"));
const cwdDir = await mkdtemp(join(tmpdir(), "arc-prompt-verify-cwd-"));
// Isolate the profile before any Pi module reads its environment.
process.env.ARC_PI_HOME = profileDir;
process.env.PI_CODING_AGENT_DIR = profileDir;

// All HTTP is intercepted: requests to the fake base URL get a canned streaming reply,
// anything else is recorded as a network attempt and fails.
const FAKE_BASE_URL = "http://arc-verify.invalid/v1";
const originalFetch = globalThis.fetch;
const networkAttempts = [];
const completions = [];
let onCompletion = () => {};
function sseReply(call) {
  const chunk = (body) => `data: ${JSON.stringify({ id: `fake-${call}`, object: "chat.completion.chunk", created: 1, model: "echo", ...body })}\n\n`;
  return (
    chunk({ choices: [{ index: 0, delta: { role: "assistant", content: `fake answer ${call}` }, finish_reason: null }] }) +
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) +
    "data: [DONE]\n\n"
  );
}
globalThis.fetch = async (input, init = {}) => {
  const request = new Request(input, init);
  if (!request.url.startsWith(FAKE_BASE_URL)) {
    networkAttempts.push(request.url);
    throw new Error("verify:arc-pi forbids network access");
  }
  const body = await request.json();
  const call = completions.length + 1;
  completions.push({
    fakeKeyPassed: request.headers.get("authorization") === `Bearer ${FAKE_KEY}`,
    maxTokens: body.max_completion_tokens ?? body.max_tokens,
    messages: body.messages.length,
  });
  onCompletion(call);
  return new Response(sseReply(call), { status: 200, headers: { "content-type": "text/event-stream" } });
};

const summary = { ok: false };
try {
  const piVersion = JSON.parse(await readFile(join(piPackageDir, "package.json"), "utf8")).version;
  const arcPiVersion = JSON.parse(await readFile(join(arcPiDir, "package.json"), "utf8")).version;
  const pi = await import(pathToFileURL(join(piPackageDir, "dist", "index.js")).href);
  Object.assign(summary, { arcPiDir, arcPiVersion, piVersion });

  // 1. Loader: only the explicit command is registered.
  const loaded = await pi.discoverAndLoadExtensions([repoRoot], cwdDir, profileDir);
  assert.deepEqual(loaded.errors, [], "extension load errors");
  assert.equal(loaded.extensions.length, 1, "exactly one extension loaded");
  const extension = loaded.extensions[0];
  assert.ok(extension.path.endsWith(join("dist", "extension", "index.js")), `unexpected extension path ${extension.path}`);
  const registered = {
    commands: [...extension.commands.keys()],
    tools: extension.tools.size,
    handlers: extension.handlers.size,
    shortcuts: extension.shortcuts.size,
    flags: extension.flags.size,
  };
  assert.deepEqual(registered, { commands: [COMMAND], tools: 0, handlers: 0, shortcuts: 0, flags: 0 });
  summary.registered = registered;
  const handler = extension.commands.get(COMMAND).handler;

  // 2. Real ARC Pi model registry (in-memory auth) with a fake provider on a built-in API type.
  const registry = pi.ModelRegistry.inMemory(pi.AuthStorage.inMemory());
  registry.registerProvider(FAKE_PROVIDER, {
    api: "openai-completions",
    baseUrl: FAKE_BASE_URL,
    apiKey: FAKE_KEY,
    models: [
      {
        id: "echo",
        name: "ARC verify echo",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_000,
        maxTokens: 4096,
      },
    ],
  });
  const fakeModel = registry.find(FAKE_PROVIDER, "echo");
  assert.ok(fakeModel, "fake model registered");
  summary.completionPath = typeof registry.complete === "function" ? "registry.complete" : "legacy getApiKeyAndHeaders + pi-ai/compat";

  // The TUI host initializes the global theme before extensions render components.
  pi.initTheme(undefined, false);
  const identity = (_color, text) => text;
  const fakeTheme = new Proxy({}, { get: (_target, key) => (key === "fg" || key === "bg" ? identity : (text) => text) });
  const fakeTui = { requestRender() {} };

  function makeContext({ mode, editorText, confirms = [], selections = [], editorResults = [], onLoader }) {
    const events = [];
    const record = (name) => (...args) => events.push({ name, args });
    const ctx = {
      mode,
      hasUI: mode === "tui" || mode === "rpc",
      cwd: cwdDir,
      model: fakeModel,
      scopedModels: [{ model: fakeModel }],
      modelRegistry: registry,
      sessionManager: { getBranch: () => [], appendEntry: record("appendEntry") },
      setModel: record("setModel"),
      sendUserMessage: record("sendUserMessage"),
      appendEntry: record("appendEntry"),
      ui: {
        notify: (message, level) => events.push({ name: "notify", args: [message, level] }),
        setStatus: record("setStatus"),
        select: async (title, options) => {
          events.push({ name: "select", args: [title, options] });
          const pick = selections.shift();
          return typeof pick === "function" ? pick(options) : pick;
        },
        confirm: async (title, message) => {
          events.push({ name: "confirm", args: [title, message] });
          return confirms.shift() ?? false;
        },
        editor: async (title, prefill) => {
          events.push({ name: "editor", args: [title, prefill] });
          const next = editorResults.shift();
          return typeof next === "function" ? next(prefill) : next;
        },
        getEditorText: () => editorText,
        setEditorText: record("setEditorText"),
        custom: (factory) =>
          new Promise((resolveCustom) => {
            events.push({ name: "custom", args: [] });
            let component;
            component = factory(fakeTui, fakeTheme, {}, (result) => {
              component?.dispose?.();
              resolveCustom(result);
            });
            onLoader?.(component);
          }),
      },
    };
    return { ctx, events };
  }

  const forbidden = ["sendUserMessage", "appendEntry", "setModel"];
  const assertNoForbidden = (events) => {
    for (const name of forbidden) assert.equal(events.some((event) => event.name === name), false, `${name} called`);
  };
  const settle = () => new Promise((resolveSettle) => setTimeout(resolveSettle, 20));
  const checks = {};

  // 3. Accept flows (TUI with the real BorderedLoader, RPC with status/notify progress).
  for (const mode of ["tui", "rpc"]) {
    completions.length = 0;
    const { ctx, events } = makeContext({
      mode,
      editorText: "Explain closures in JavaScript.",
      confirms: [true, true],
      selections: [(options) => options[0]],
      editorResults: [(prefill) => `${prefill} (edited)`],
    });
    if (mode === "rpc") delete ctx.ui.custom;
    await handler("", ctx);
    const writes = events.map((event, index) => ({ event, index })).filter(({ event }) => event.name === "setEditorText");
    const confirmIndexes = events.map((event, index) => (event.name === "confirm" ? index : -1)).filter((index) => index >= 0);
    assert.equal(completions.length, 4, `${mode}: expected 4 fake completions`);
    assert.ok(completions.every((call) => call.fakeKeyPassed && call.maxTokens <= 4096), `${mode}: completion options`);
    assert.equal(writes.length, 1, `${mode}: editor replaced exactly once`);
    assert.equal(confirmIndexes.length, 2, `${mode}: cost and replace confirmations`);
    assert.ok(writes[0].index > confirmIndexes[1], `${mode}: editor replaced only after the replace confirmation`);
    assert.match(writes[0].event.args[0], / \(edited\)$/u);
    assert.equal(events.some((event) => event.name === "custom"), mode === "tui");
    assertNoForbidden(events);
    checks[`${mode}Accept`] = { completions: completions.length, editorWrites: writes.length, replacedAfterConfirm: true };
  }

  // 4. Declining the replace confirmation leaves the editor unchanged.
  for (const mode of ["tui", "rpc"]) {
    completions.length = 0;
    const { ctx, events } = makeContext({
      mode,
      editorText: "Explain closures in JavaScript.",
      confirms: [true, false],
      selections: [(options) => options[0]],
      editorResults: [(prefill) => prefill],
    });
    await handler("", ctx);
    assert.equal(completions.length, 4);
    assert.equal(events.some((event) => event.name === "setEditorText"), false, `${mode}: editor unchanged`);
    assertNoForbidden(events);
    checks[`${mode}DeclineReplace`] = { completions: completions.length, editorWrites: 0 };
  }

  // 5. Escape on the real TUI loader during the run cancels and stops further completions.
  {
    completions.length = 0;
    let loader;
    onCompletion = (call) => {
      if (call === 1) loader.handleInput("");
    };
    const { ctx, events } = makeContext({
      mode: "tui",
      editorText: "Explain closures in JavaScript.",
      confirms: [true, true],
      selections: [(options) => options[0]],
      editorResults: [(prefill) => prefill],
      onLoader: (component) => {
        loader = component;
      },
    });
    await handler("", ctx);
    await settle();
    onCompletion = () => {};
    assert.equal(loader.signal.aborted, true, "escape aborted the loader signal");
    assert.equal(completions.length, 1, "no completions after cancellation");
    assert.equal(events.some((event) => event.name === "setEditorText"), false);
    assert.match(events.filter((event) => event.name === "notify").at(-1).args[0], /cancelled/u);
    assertNoForbidden(events);
    checks.tuiCancel = { completions: completions.length, editorWrites: 0 };
  }

  // 6. Print and JSON modes are refused before any prompt or completion.
  for (const mode of ["print", "json"]) {
    completions.length = 0;
    const { ctx, events } = makeContext({ mode, editorText: "Explain closures in JavaScript.", confirms: [true, true] });
    await assert.rejects(handler("", ctx), (error) => error.name === "PromptOptimizeUnsupportedModeError");
    assert.equal(completions.length, 0);
    assert.deepEqual(events, []);
    checks[`${mode}Refused`] = true;
  }
  await settle();

  // 7. Isolation: no network, no credentials in the temp profile, real ARC Pi home untouched.
  assert.deepEqual(networkAttempts, [], "network attempts");
  const profileFiles = await listFiles(profileDir);
  assert.deepEqual(profileFiles.filter((file) => CREDENTIAL_FILE.test(file)), [], "credential-like files in temp profile");
  const realAfter = await snapshotDir(realArcPiHome);
  const changed = Object.keys({ ...realBefore.entries, ...realAfter.entries }).filter(
    (name) => realBefore.entries[name] !== realAfter.entries[name],
  );
  assert.deepEqual(changed, [], `real ARC Pi home entries changed: ${changed.join(", ")}`);
  assert.equal(realAfter.exists, realBefore.exists);
  assert.equal(realAfter.mtimeMs, realBefore.mtimeMs, "real ARC Pi home mtime changed");
  Object.assign(summary, {
    checks,
    networkAttempts: networkAttempts.length,
    tempProfileFiles: profileFiles,
    realArcPiHome: { path: realArcPiHome, exists: realBefore.exists, entries: Object.keys(realBefore.entries).length, unchanged: true },
    ok: true,
  });
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  await rm(profileDir, { recursive: true, force: true });
  await rm(cwdDir, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`, () => process.exit());
