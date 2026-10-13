import { describe, expect, it } from "vitest";
import { MemoryRunStore, RUN_TTL_MS, RedisRunStore, isRunId, type RedisLike, type RunRecord } from "@/lib/run-store";

const record: RunRecord = { id: "run-1", status: "running", model: "anthropic/claude-sonnet-4-5", judge: false, rewrite: true, createdAt: 1_000, updatedAt: 1_000, steps: [] };

describe("isRunId", () => {
  it("accepts UUIDs and rejects anything else", () => {
    expect(isRunId("3b241101-e2bb-4255-8caf-4136c566a962")).toBe(true);
    expect(isRunId(null)).toBe(false);
    expect(isRunId("")).toBe(false);
    expect(isRunId("../etc")).toBe(false);
    expect(isRunId("x".repeat(65))).toBe(false);
  });
});

describe("MemoryRunStore", () => {
  it("saves, reads, cancels, and deletes runs", async () => {
    const store = new MemoryRunStore(() => 5_000);
    await store.save(record);
    expect(await store.get("run-1")).toEqual(record);
    expect(await store.cancelRequested("run-1")).toBe(false);
    await store.requestCancel("run-1");
    expect(await store.cancelRequested("run-1")).toBe(true);
    // A later save keeps the cancel flag.
    await store.save({ ...record, steps: [{ step: "rewrite", status: "rewritten" }] });
    expect(await store.cancelRequested("run-1")).toBe(true);
    await store.delete("run-1");
    expect(await store.get("run-1")).toBeUndefined();
    expect(await store.cancelRequested("run-1")).toBe(false);
  });

  it("expires runs after the TTL", async () => {
    let now = 10_000;
    const store = new MemoryRunStore(() => now);
    await store.save({ ...record, updatedAt: now });
    now += RUN_TTL_MS - 1;
    expect(await store.get("run-1")).toBeDefined();
    now += 2;
    expect(await store.get("run-1")).toBeUndefined();
    expect(store.size).toBe(0);
  });
});

describe("RedisRunStore", () => {
  it("stores records and the cancel flag under prefixed keys with a TTL", async () => {
    const data = new Map<string, { value: unknown; ex: number }>();
    const redis: RedisLike = {
      async get<T>(key: string) { return (data.get(key)?.value as T | undefined) ?? null; },
      async set(key, value, options) { data.set(key, { value, ex: options.ex }); },
      async del(...keys) { for (const key of keys) data.delete(key); },
    };
    const store = new RedisRunStore(redis, 60_000);
    await store.save(record);
    expect(data.get("arc-prompt-optimizer:run:run-1")).toEqual({ value: record, ex: 60 });
    expect(await store.get("run-1")).toEqual(record);
    expect(await store.get("missing")).toBeUndefined();
    expect(await store.cancelRequested("run-1")).toBe(false);
    await store.requestCancel("run-1");
    expect(await store.cancelRequested("run-1")).toBe(true);
    await store.delete("run-1");
    expect(data.size).toBe(0);
  });
});
