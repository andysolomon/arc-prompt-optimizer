import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { MAX_COMPLETION_OUTPUT_CHARACTERS, outputCharacterLimitToMaxTokens } from "../dist/core/index.js";
import {
  MAX_EXTENSION_PROMPT_CHARACTERS,
  REVIEW_SELECT_TITLE,
  runPromptOptimizeCommand,
} from "../dist/extension/index.js";

// Complements test/boundaries.test.mjs (core: no network, credentials, fs) and the isolation test in
// test/extension.test.mjs (extension: no CLI import, credentials, fs, persistence, submission, input hooks,
// tools). Cancellation that stops completions and keeps the editor is covered by
// "cancelling the TUI loader stops completions and leaves the editor unchanged" in test/extension.test.mjs.

const rootUrl = new URL("../", import.meta.url);
const SENTINEL = "SECRET-SENTINEL-sk-test";

async function sources(dir) {
  const dirUrl = new URL(dir, rootUrl);
  const files = (await readdir(dirUrl)).filter((name) => name.endsWith(".ts")).sort();
  return await Promise.all(files.map(async (name) => ({ name: `${dir}${name}`, text: await readFile(new URL(name, dirUrl), "utf8") })));
}

test("library and extension code never log, spawn, fetch, or write files by default", async () => {
  const files = [...(await sources("src/core/")), ...(await sources("src/adapters/")), ...(await sources("src/extension/"))];
  assert.ok(files.length > 0);
  for (const { name, text } of files) {
    for (const [label, forbidden] of [
      ["console output", /\bconsole\s*\.\s*\w+/u],
      ["direct stdio writes", /process\s*\.\s*(?:stdout|stderr)/u],
      ["filesystem access", /["'](?:node:)?fs(?:\/promises)?["']|writeFile|appendFile|createWriteStream/u],
      ["environment reads", /process\s*\.\s*env/u],
      ["child processes", /child_process|\bspawn\s*\(|\bexecFile\s*\(/u],
      ["direct network", /\bfetch\s*\(|["']node:https?["']|XMLHttpRequest|WebSocket/u],
    ]) {
      assert.doesNotMatch(text, forbidden, `${label} in ${name}`);
    }
  }
});

test("the extension registers no event handlers, tools, shortcuts, or flags that could intercept prompts", async () => {
  const source = (await sources("src/extension/")).map(({ text }) => text).join("\n");
  for (const [label, forbidden] of [
    ["event handler", /\bpi\s*\.\s*on\s*\(|\.on\s*\(\s*["'][a-z_]+["']/u],
    ["tool", /registerTool/u],
    ["shortcut", /registerShortcut/u],
    ["flag", /registerFlag/u],
    ["message renderer or provider", /registerMessageRenderer|registerProvider/u],
  ]) {
    assert.doesNotMatch(source, forbidden, label);
  }
});

const MODEL = Object.freeze({ provider: "fake", id: "model-a", maxTokens: 4096 });

function fakeRegistry(reply = (prompt) => `echo: ${prompt}`) {
  const calls = [];
  return {
    calls,
    getAvailable: () => [MODEL],
    getAll: () => [MODEL],
    complete: async (model, context, options) => {
      const prompt = context.messages[0].content;
      calls.push({ prompt, options });
      return {
        role: "assistant",
        content: [{ type: "text", text: reply(prompt) }],
        provider: model.provider,
        model: model.id,
        stopReason: "stop",
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      };
    },
  };
}

const fakeLoader = () => {
  const controller = new AbortController();
  return { signal: controller.signal, onAbort: undefined };
};

function commandContext({ mode = "tui", editorText = "", registry = fakeRegistry(), confirms = [true, true] } = {}) {
  const events = [];
  const record = (name) => (...args) => events.push({ name, args });
  const ctx = {
    mode,
    hasUI: true,
    model: MODEL,
    scopedModels: [],
    modelRegistry: registry,
    sessionManager: { getBranch: () => [] },
    ui: {
      notify: record("notify"),
      setStatus: record("setStatus"),
      select: async (title, options) => {
        events.push({ name: "select", args: [title, options] });
        return options[0];
      },
      confirm: async (...args) => {
        events.push({ name: "confirm", args });
        return confirms.shift() ?? false;
      },
      editor: async (title, prefill) => {
        events.push({ name: "editor", args: [title, prefill] });
        return prefill;
      },
      getEditorText: () => editorText,
      setEditorText: record("setEditorText"),
      custom: (factory) => new Promise((resolve) => factory({}, {}, {}, resolve)),
    },
  };
  if (mode === "rpc") delete ctx.ui.custom;
  return { ctx, events, registry };
}

const deps = { createLoader: fakeLoader };
const reported = (events) =>
  events.filter((event) => event.name === "notify" || event.name === "setStatus").flatMap((event) => event.args.map(String));

test("an over-limit prompt is refused before any confirmation or completion", async () => {
  const { ctx, events, registry } = commandContext();
  const outcome = await runPromptOptimizeCommand("x".repeat(MAX_EXTENSION_PROMPT_CHARACTERS + 1), ctx, deps);
  assert.equal(outcome.status, "no_source");
  assert.equal(registry.calls.length, 0);
  assert.equal(events.some((event) => event.name === "confirm" || event.name === "setEditorText"), false);
});

test("preview completions request a bounded output and over-limit replies fail without touching the editor", async () => {
  const bounded = commandContext();
  await runPromptOptimizeCommand("Explain closures.", bounded.ctx, deps);
  assert.equal(bounded.registry.calls.length, 4);
  const expectedMaxTokens = outputCharacterLimitToMaxTokens(MAX_COMPLETION_OUTPUT_CHARACTERS, MODEL);
  for (const call of bounded.registry.calls) {
    assert.equal(call.options.maxTokens, expectedMaxTokens);
    assert.ok(call.options.maxTokens <= MODEL.maxTokens);
  }

  const oversized = "y".repeat(MAX_COMPLETION_OUTPUT_CHARACTERS + 1);
  const { ctx, events, registry } = commandContext({ registry: fakeRegistry(() => oversized) });
  const outcome = await runPromptOptimizeCommand("Explain closures.", ctx, deps);
  assert.equal(outcome.status, "failed");
  assert.equal(registry.calls.length, 1, "the run stops at the first over-limit reply");
  assert.equal(events.some((event) => event.name === "setEditorText"), false);
  assert.ok(reported(events).every((message) => !message.includes(oversized.slice(0, 64))));
});

test("prompt and completion text never reach notify or status messages", async () => {
  const prompt = `Summarize the deploy notes. Token: ${SENTINEL}`;
  for (const mode of ["tui", "rpc"]) {
    for (const source of ["args", "editor"]) {
      const { ctx, events, registry } = commandContext({ mode, editorText: source === "editor" ? prompt : "" });
      const outcome = await runPromptOptimizeCommand(source === "args" ? prompt : "", ctx, deps);
      assert.equal(outcome.status, "accepted", `${mode}/${source}`);
      assert.ok(registry.calls.every((call) => call.prompt.includes(SENTINEL)), "the sentinel reached the model");
      assert.ok(events.some((event) => event.name === "select" && event.args[0] === REVIEW_SELECT_TITLE));
      const leaks = reported(events).filter((message) => message.includes(SENTINEL));
      assert.deepEqual(leaks, [], `${mode}/${source} leaked prompt text into notify/status`);
    }
  }

  const failing = fakeRegistry();
  failing.complete = async () => {
    throw new Error("provider unavailable");
  };
  const { ctx, events } = commandContext({ registry: failing });
  assert.equal((await runPromptOptimizeCommand(prompt, ctx, deps)).status, "failed");
  assert.deepEqual(reported(events).filter((message) => message.includes(SENTINEL)), []);
});
