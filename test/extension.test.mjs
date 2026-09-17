import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import arcPromptOptimizerExtension, {
  MAX_EXTENSION_PROMPT_CHARACTERS,
  PREVIEW_COMPLETION_COUNT,
  PROMPT_OPTIMIZE_COMMAND,
  PromptOptimizeUnsupportedModeError,
  REVIEW_KEEP_OPTION,
  REVIEW_SELECT_TITLE,
  buildPreviewCandidates,
  candidateSummaryLine,
  collectPromptSources,
  handlePromptOptimize,
  lineDiffSummary,
  listTargetModels,
  promptOptimizeModeSupport,
  resolvePromptSource,
  resolveTargetModel,
  reviewCandidates,
  runPreview,
  runPromptOptimizeCommand,
  runWithProgress,
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
  assert.deepEqual(packageJson.pi, { extensions: ["./dist/extension/index.js"], skills: ["./skills"] });
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

test("mode support allows TUI and RPC and refuses print/JSON", () => {
  assert.deepEqual(promptOptimizeModeSupport("tui"), { supported: true });
  assert.deepEqual(promptOptimizeModeSupport("rpc"), { supported: true });
  for (const mode of ["json", "print"]) {
    const support = promptOptimizeModeSupport(mode);
    assert.equal(support.supported, false);
    assert.match(support.reason, /arc-prompt CLI/u);
  }
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

// ---------------------------------------------------------------------------
// Step A: source, models, preview run, progress, command flow
// ---------------------------------------------------------------------------

const MODEL_A = Object.freeze({ provider: "fake", id: "model-a", maxTokens: 4096 });
const MODEL_B = Object.freeze({ provider: "fake", id: "model-b", maxTokens: 4096 });

function userEntry(content) {
  return { type: "message", message: { role: "user", content } };
}

function fakeRegistry(models = [MODEL_A, MODEL_B], onComplete = () => {}) {
  const calls = [];
  return {
    calls,
    getAvailable: () => models,
    getAll: () => models,
    complete: async (model, context, options) => {
      calls.push({ model: `${model.provider}/${model.id}`, prompt: context.messages[0].content, options });
      onComplete(calls.length, options);
      return {
        role: "assistant",
        content: [{ type: "text", text: `answer ${calls.length}` }],
        provider: model.provider,
        model: model.id,
        stopReason: "stop",
        usage: { input: 10, output: 5, cost: { total: 0.001 } },
        timestamp: Date.now(),
      };
    },
  };
}

function fakeLoaderFactory(created) {
  return () => {
    const controller = new AbortController();
    const loader = {
      signal: controller.signal,
      onAbort: undefined,
      abort() {
        controller.abort();
        loader.onAbort?.();
      },
    };
    created.push(loader);
    return loader;
  };
}

function commandContext({
  mode = "tui",
  editorText = "",
  branch = [],
  selections = [],
  confirm = true,
  confirms = undefined,
  editorResults = [],
  registry = fakeRegistry(),
  model = undefined,
  scopedModels = [],
} = {}) {
  const events = [];
  const record = (name) => (...args) => events.push({ name, args });
  const selectQueue = [...selections];
  const confirmQueue = confirms === undefined ? undefined : [...confirms];
  const editorQueue = [...editorResults];
  const ctx = {
    mode,
    hasUI: true,
    model,
    scopedModels,
    modelRegistry: registry,
    sessionManager: { getBranch: () => branch, appendEntry: record("appendEntry") },
    setModel: record("setModel"),
    sendUserMessage: record("sendUserMessage"),
    appendEntry: record("appendEntry"),
    ui: {
      notify: (message, level) => events.push({ name: "notify", args: [message, level] }),
      select: async (title, options) => {
        events.push({ name: "select", args: [title, options] });
        const pick = selectQueue.shift();
        return typeof pick === "function" ? pick(options) : pick;
      },
      confirm: async (title, message) => {
        events.push({ name: "confirm", args: [title, message] });
        return confirmQueue === undefined ? confirm : confirmQueue.shift();
      },
      editor: async (title, prefill) => {
        events.push({ name: "editor", args: [title, prefill] });
        const next = editorQueue.shift();
        return typeof next === "function" ? next(prefill) : next;
      },
      getEditorText: () => editorText,
      setEditorText: record("setEditorText"),
      setStatus: record("setStatus"),
      custom: (factory) =>
        new Promise((resolve) => {
          events.push({ name: "custom", args: [] });
          factory({}, {}, {}, resolve);
        }),
    },
  };
  return { ctx, events, registry };
}

const forbiddenCalls = ["setEditorText", "sendUserMessage", "appendEntry", "setModel"];

function assertNoForbiddenCalls(events) {
  for (const name of forbiddenCalls) {
    assert.equal(events.some((event) => event.name === name), false, `${name} must not be called`);
  }
}

test("source collection prefers trimmed command args over the editor and messages", () => {
  const sources = collectPromptSources("  from args  ", "draft", [userEntry("hello")]);
  assert.deepEqual(sources, [{ label: "command input", text: "from args" }]);
});

test("source collection offers the editor draft and latest user message text blocks", () => {
  const branch = [
    userEntry("older"),
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } },
    userEntry([{ type: "image", data: "x" }, { type: "text", text: "newest" }, { type: "text", text: "part" }]),
    { type: "custom", customType: "x" },
  ];
  assert.deepEqual(collectPromptSources("   ", "draft", branch), [
    { label: "editor draft", text: "draft" },
    { label: "latest user message", text: "newest\npart" },
  ]);
  assert.deepEqual(collectPromptSources("", "  ", [userEntry([{ type: "image", data: "x" }])]), []);
});

test("source resolution uses a lone source, asks between two, and reports none", async () => {
  const lone = commandContext({ editorText: "only draft" });
  assert.deepEqual(await resolvePromptSource("", lone.ctx), { label: "editor draft", text: "only draft" });
  assert.equal(lone.events.some((event) => event.name === "select"), false);

  const two = commandContext({
    editorText: "draft",
    branch: [userEntry("message")],
    selections: [(options) => options[1]],
  });
  assert.deepEqual(await resolvePromptSource("", two.ctx), { label: "latest user message", text: "message" });
  assert.equal(two.events.find((event) => event.name === "select").args[1].length, 2);

  const cancelled = commandContext({ editorText: "draft", branch: [userEntry("message")], selections: [undefined] });
  assert.equal(await resolvePromptSource("", cancelled.ctx), undefined);

  const none = commandContext();
  assert.equal(await resolvePromptSource("", none.ctx), undefined);
  assert.equal(none.events.at(-1).args[1], "error");
});

test("source resolution enforces the 16,384 character limit", async () => {
  const atLimit = commandContext();
  const ok = "a".repeat(MAX_EXTENSION_PROMPT_CHARACTERS);
  assert.equal((await resolvePromptSource(ok, atLimit.ctx)).text.length, MAX_EXTENSION_PROMPT_CHARACTERS);

  const tooLarge = commandContext({ editorText: "b".repeat(MAX_EXTENSION_PROMPT_CHARACTERS + 1) });
  assert.equal(await resolvePromptSource("", tooLarge.ctx), undefined);
  const notice = tooLarge.events.find((event) => event.name === "notify");
  assert.equal(notice.args[1], "error");
  assert.match(notice.args[0], /16384/u);
});

test("target models prefer scoped models, de-duplicate, and list the active model first", async () => {
  const registry = fakeRegistry([MODEL_A, MODEL_B, { ...MODEL_A }]);
  assert.deepEqual(
    listTargetModels({ model: MODEL_B, scopedModels: [], modelRegistry: registry }).map((target) => target.reference),
    ["fake/model-b", "fake/model-a"],
  );
  const scoped = [{ model: MODEL_A }, { model: { provider: "other", id: "model-c" } }, { model: MODEL_A }];
  assert.deepEqual(
    listTargetModels({ model: { provider: "other", id: "model-c" }, scopedModels: scoped, modelRegistry: registry }).map(
      (target) => target.reference,
    ),
    ["other/model-c", "fake/model-a"],
  );
});

test("target model resolution auto-selects, asks, reports none, and never changes the session model", async () => {
  const single = commandContext({ registry: fakeRegistry([MODEL_A]) });
  assert.equal((await resolveTargetModel(single.ctx)).reference, "fake/model-a");
  assert.equal(single.events.some((event) => event.name === "select"), false);

  const many = commandContext({ model: MODEL_B, selections: [(options) => options[1]] });
  assert.equal((await resolveTargetModel(many.ctx)).reference, "fake/model-a");
  assert.deepEqual(many.events.find((event) => event.name === "select").args[1], ["fake/model-b", "fake/model-a"]);

  const none = commandContext({ registry: fakeRegistry([]) });
  assert.equal(await resolveTargetModel(none.ctx), undefined);
  assert.equal(none.events.at(-1).args[1], "error");
  assertNoForbiddenCalls([...single.events, ...many.events, ...none.events]);
});

test("preview candidates are the baseline plus three pattern variants", () => {
  const candidates = buildPreviewCandidates("Summarize the release notes.");
  assert.equal(candidates.length, 4);
  assert.equal(PREVIEW_COMPLETION_COUNT, 4);
  assert.equal(candidates[0].origin, "fixture");
  assert.equal(candidates[0].prompt.text, "Summarize the release notes.");
  assert.match(candidates[0].id, /^baseline-[0-9a-f]{8}$/u);
  assert.deepEqual(candidates.slice(1).map((candidate) => candidate.prompt.pattern), ["critique", "decomposition", "chain_of_thought"]);
  assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 4);
});

test("the preview run uses four completions on the selected model and ranks every candidate", async () => {
  const registry = fakeRegistry();
  const result = await runPreview({ prompt: "Draft a haiku.", model: "fake/model-b", modelRegistry: registry });
  assert.equal(registry.calls.length, 4);
  assert.equal(result.completionsUsed, 4);
  assert.ok(registry.calls.every((call) => call.model === "fake/model-b"));
  assert.equal(registry.calls[0].prompt, "Draft a haiku.");
  assert.equal(result.ranking.length, 4);
  assert.equal(result.evaluations.length, 4);
  assert.equal(result.baselineCandidateId, result.candidates[0].id);
});

test("aborting the preview run stops further completions", async () => {
  const controller = new AbortController();
  const registry = fakeRegistry([MODEL_A], () => controller.abort());
  await assert.rejects(
    runPreview({ prompt: "Draft a haiku.", model: "fake/model-a", modelRegistry: registry, signal: controller.signal }),
    (error) => error.name === "CompletionCancelledError",
  );
  assert.equal(registry.calls.length, 1);
});

test("RPC progress uses status and notify, then clears the status", async () => {
  const { ctx, events } = commandContext({ mode: "rpc" });
  const result = await runWithProgress(ctx, "Working...", async (signal) => {
    assert.equal(signal.aborted, false);
    return 42;
  });
  assert.deepEqual(result, { status: "completed", value: 42 });
  assert.equal(events.some((event) => event.name === "custom"), false);
  const statuses = events.filter((event) => event.name === "setStatus").map((event) => event.args[1]);
  assert.deepEqual(statuses, ["Working...", undefined]);

  const failed = await runWithProgress(ctx, "Working...", async () => {
    throw new Error("boom");
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.message, "boom");
});

test("TUI progress runs inside the loader and reports cancellation", async () => {
  const { ctx } = commandContext();
  const loaders = [];
  const cancelled = await runWithProgress(
    ctx,
    "Working...",
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        loaders[0].abort();
      }),
    { createLoader: fakeLoaderFactory(loaders) },
  );
  assert.deepEqual(cancelled, { status: "cancelled" });
  const completed = await runWithProgress(ctx, "Working...", async () => "done", { createLoader: fakeLoaderFactory([]) });
  assert.deepEqual(completed, { status: "completed", value: "done" });
});

test("the command confirms cost before calling a model and declining makes no completions", async () => {
  const { ctx, events, registry } = commandContext({ selections: [(options) => options[0]], confirm: false });
  const outcome = await runPromptOptimizeCommand("Explain closures.", ctx, { createLoader: fakeLoaderFactory([]) });
  assert.equal(outcome.status, "declined");
  assert.equal(registry.calls.length, 0);
  const confirm = events.find((event) => event.name === "confirm");
  assert.match(confirm.args[1], /4 model completions/u);
  assert.match(confirm.args[1], /fake\/model-a/u);
  assertNoForbiddenCalls(events);
});

test("the command runs the preview, notifies a ranked summary, and keeps the editor when review is dismissed", async () => {
  const { ctx, events, registry } = commandContext({
    model: MODEL_B,
    editorText: "Explain closures.",
    selections: [(options) => options[0]],
  });
  const outcome = await runPromptOptimizeCommand("", ctx, { createLoader: fakeLoaderFactory([]) });
  assert.equal(outcome.status, "kept");
  assert.equal(outcome.result.ranking.length, 4);
  assert.equal(outcome.source.label, "editor draft");
  assert.equal(outcome.model.reference, "fake/model-b");
  assert.equal(registry.calls.length, 4);
  const summary = events.filter((event) => event.name === "notify").at(-1);
  assert.equal(summary.args[1], "info");
  assert.match(summary.args[0], /baseline \(source\)/u);
  assert.match(summary.args[0], /score/u);
  assert.match(summary.args[0], /latency/u);
  assertNoForbiddenCalls(events);
});

test("cancelling the TUI loader stops completions and leaves the editor unchanged", async () => {
  const loaders = [];
  const registry = fakeRegistry([MODEL_A], () => loaders[0].abort());
  const { ctx, events } = commandContext({ registry });
  const outcome = await runPromptOptimizeCommand("Explain closures.", ctx, { createLoader: fakeLoaderFactory(loaders) });
  assert.equal(outcome.status, "cancelled");
  assert.equal(events.some((event) => event.name === "select" && event.args[0] === REVIEW_SELECT_TITLE), false);
  // Let the aborted completion settle before counting calls.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(registry.calls.length, 1);
  const notice = events.filter((event) => event.name === "notify").at(-1);
  assert.equal(notice.args[1], "info");
  assert.match(notice.args[0], /cancelled/u);
  assertNoForbiddenCalls(events);
});

test("a failed preview run is reported as an error", async () => {
  const { ctx, events } = commandContext({ registry: fakeRegistry([MODEL_A]) });
  const outcome = await runPromptOptimizeCommand("Explain closures.", ctx, {
    createLoader: fakeLoaderFactory([]),
    runPreview: async () => {
      throw new Error("provider unavailable");
    },
  });
  assert.equal(outcome.status, "failed");
  assert.equal(events.some((event) => event.name === "select" && event.args[0] === REVIEW_SELECT_TITLE), false);
  const notice = events.filter((event) => event.name === "notify").at(-1);
  assert.equal(notice.args[1], "error");
  assert.match(notice.args[0], /provider unavailable/u);
  assertNoForbiddenCalls(events);
});

test("the TUI command handler reports a missing prompt instead of running", async () => {
  const { ctx, events, registry } = commandContext();
  await handlePromptOptimize("", ctx);
  assert.equal(registry.calls.length, 0);
  assert.equal(events.filter((event) => event.name === "notify").at(-1).args[1], "error");
});

// ---------------------------------------------------------------------------
// Step B: review, acceptance, modes
// ---------------------------------------------------------------------------

const unknown = Object.freeze({ status: "unknown", reason: "not reported" });

function syntheticResult() {
  const candidates = [
    { id: "base", prompt: { pattern: "baseline", text: "line one\nline two", variablesUsed: [] }, origin: "fixture", metadata: { label: "baseline" } },
    { id: "crit", prompt: { pattern: "critique", text: "line one\nline two\nline three", variablesUsed: [] }, origin: "rendered", metadata: { label: "critique" } },
  ];
  const aggregate = (passed) => ({ caseCount: 1, passedCaseCount: passed ? 1 : 0 });
  return {
    baselineCandidateId: "base",
    candidates,
    evaluations: [
      { candidateId: "base", cases: [], aggregate: aggregate(false) },
      { candidateId: "crit", cases: [], aggregate: aggregate(true) },
    ],
    ranking: [
      {
        rank: 1,
        candidateId: "crit",
        quality: { combined: { status: "measured", value: 0.9 }, deterministic: unknown, judge: unknown },
        operational: { latencyMs: { status: "measured", value: 120.4 }, totalTokens: unknown, costUsd: unknown },
        tiedWith: [],
        tieBrokenBy: null,
      },
      {
        rank: 2,
        candidateId: "base",
        quality: { combined: unknown, deterministic: unknown, judge: unknown },
        operational: { latencyMs: unknown, totalTokens: { status: "measured", value: 15 }, costUsd: { status: "measured", value: 0.001 } },
        tiedWith: [],
        tieBrokenBy: null,
      },
    ],
    completionsUsed: 2,
  };
}

const SOURCE = Object.freeze({ label: "editor draft", text: "line one\nline two" });

test("line diff summary counts added, removed, and unchanged lines", () => {
  assert.deepEqual(lineDiffSummary("a\nb\nc", "a\nx\nc\nd"), { added: 2, removed: 1, unchanged: 2, summary: "+2 -1 lines" });
  assert.deepEqual(lineDiffSummary("same", "same"), { added: 0, removed: 0, unchanged: 1, summary: "+0 -0 lines" });
  assert.deepEqual(lineDiffSummary("", "a\nb"), { added: 2, removed: 0, unchanged: 0, summary: "+2 -0 lines" });
  const big = Array.from({ length: 8000 }, (_, index) => `l${index}`).join("\n");
  const bigDiff = lineDiffSummary(big, `x\n${big.split("\n").reverse().join("\n")}`);
  assert.equal(bigDiff.added - bigDiff.removed, 1);
});

test("candidate summary lines show rank, label, measurements or n/a, and the diff", () => {
  const result = syntheticResult();
  const top = candidateSummaryLine(result, result.ranking[0]);
  assert.match(top, /^1\. critique \| score 0\.90 \| passed \| latency 120ms \| tokens n\/a \| cost n\/a \| diff \+1 -0 lines$/u);
  const base = candidateSummaryLine(result, result.ranking[1]);
  assert.match(base, /^2\. baseline \(source\) \| score n\/a \| failed \| latency n\/a \| tokens 15 \| cost \$0\.0010 \| diff \+0 -0 lines$/u);
});

test("accepting a candidate replaces the editor text exactly once with the edited text", async () => {
  const { ctx, events } = commandContext({
    editorText: "line one\nline two",
    selections: [(options) => options[0]],
    editorResults: [(prefill) => `${prefill}\nedited`],
  });
  const outcome = await reviewCandidates(ctx, syntheticResult(), SOURCE);
  assert.deepEqual(outcome, { status: "accepted", candidateId: "crit", text: "line one\nline two\nline three\nedited" });
  const select = events.find((event) => event.name === "select");
  assert.equal(select.args[0], REVIEW_SELECT_TITLE);
  assert.equal(select.args[1].at(-1), REVIEW_KEEP_OPTION);
  assert.equal(events.find((event) => event.name === "editor").args[0], "Edit candidate: critique");
  const confirm = events.find((event) => event.name === "confirm");
  assert.match(confirm.args[1], /17 characters/u);
  assert.match(confirm.args[1], /35 characters/u);
  assert.match(confirm.args[1], /Nothing will be submitted/u);
  const writes = events.filter((event) => event.name === "setEditorText");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args, [outcome.text]);
  for (const name of ["sendUserMessage", "appendEntry", "setModel"]) {
    assert.equal(events.some((event) => event.name === name), false);
  }
});

test("every review cancel point keeps the editor unchanged", async () => {
  const cases = [
    { selections: [undefined] },
    { selections: [(options) => options.at(-1)] },
    { selections: [(options) => options[0]], editorResults: [undefined] },
    { selections: [(options) => options[1]], editorResults: [(prefill) => prefill], confirm: false },
  ];
  for (const options of cases) {
    const { ctx, events } = commandContext(options);
    assert.deepEqual(await reviewCandidates(ctx, syntheticResult(), SOURCE), { status: "kept" });
    assertNoForbiddenCalls(events);
  }
});

test("RPC mode runs the full dialog flow without custom UI and accepts a reviewed candidate", async () => {
  const registry = fakeRegistry([MODEL_A]);
  const previews = [];
  const { ctx, events } = commandContext({
    mode: "rpc",
    registry,
    editorText: "Explain closures.",
    confirms: [true, true],
    selections: [(options) => options[0]],
    editorResults: [(prefill) => `${prefill} (edited)`],
  });
  delete ctx.ui.custom;
  const outcome = await runPromptOptimizeCommand("", ctx, {
    runPreview: async (options) => {
      previews.push(options);
      return await runPreview({ ...options, modelRegistry: registry });
    },
  });
  assert.equal(outcome.status, "accepted");
  assert.equal(previews.length, 1);
  assert.equal(registry.calls.length, 4);
  assert.equal(events.some((event) => event.name === "custom"), false);
  const writes = events.filter((event) => event.name === "setEditorText");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args, [outcome.text]);
  assert.match(outcome.text, / \(edited\)$/u);
  assert.equal(events.filter((event) => event.name === "notify").at(-1).args[0], "Editor text replaced; review and submit it yourself.");
  for (const name of ["sendUserMessage", "appendEntry", "setModel"]) {
    assert.equal(events.some((event) => event.name === name), false);
  }
});
