import "server-only";
import { Redis } from "@upstash/redis";
import type { ServerEnv } from "@/lib/env";
import type { RunErrorInfo } from "@/lib/run-log";
import type { AttachmentInfo, ModelId, OptimizeResult, RefineSettings, StepEvent } from "@/lib/types";

export type RunStatus = "running" | "done" | "failed" | "cancelled";

/**
 * One background run. The record holds the result (which contains prompts and outputs) only until the client
 * collects it and deletes the run, or until {@link RUN_TTL_MS} passes, whichever comes first.
 */
export interface RunRecord {
  readonly id: string;
  readonly status: RunStatus;
  readonly model: ModelId;
  readonly judge: boolean;
  readonly rewrite: boolean;
  readonly refine?: RefineSettings;
  /** Names, types, and sizes of the attached images; the image data itself is never stored. */
  readonly attachments?: readonly AttachmentInfo[];
  /** Epoch milliseconds. */
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly steps: readonly StepEvent[];
  readonly result?: OptimizeResult;
  readonly error?: RunErrorInfo;
}

export interface RunStore {
  get(id: string): Promise<RunRecord | undefined>;
  save(record: RunRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /** Asks the instance executing the run to stop; it checks between steps. */
  requestCancel(id: string): Promise<void>;
  cancelRequested(id: string): Promise<boolean>;
}

/** How long a run and its result stay available to be collected. */
export const RUN_TTL_MS = 30 * 60 * 1000;
export const RUN_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/u;

export function isRunId(value: string | null): value is string {
  return value !== null && RUN_ID_PATTERN.test(value);
}

/** In-process store. Shared across route modules through `globalThis`; per instance, so it suits local use. */
export class MemoryRunStore implements RunStore {
  readonly #records = new Map<string, RunRecord>();
  /** Cancel requests by run id with the time they were made; kept apart so a cancel can precede the first save. */
  readonly #cancels = new Map<string, number>();
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(now: () => number = Date.now, ttlMs = RUN_TTL_MS) {
    this.#now = now;
    this.#ttlMs = ttlMs;
  }

  #prune(): void {
    const now = this.#now();
    for (const [id, record] of this.#records) if (now - record.updatedAt > this.#ttlMs) this.#records.delete(id);
    for (const [id, at] of this.#cancels) if (now - at > this.#ttlMs) this.#cancels.delete(id);
  }

  async get(id: string): Promise<RunRecord | undefined> {
    this.#prune();
    return this.#records.get(id);
  }

  async save(record: RunRecord): Promise<void> {
    this.#prune();
    this.#records.set(record.id, record);
  }

  async delete(id: string): Promise<void> {
    this.#records.delete(id);
    this.#cancels.delete(id);
  }

  async requestCancel(id: string): Promise<void> {
    this.#cancels.set(id, this.#now());
  }

  async cancelRequested(id: string): Promise<boolean> {
    this.#prune();
    return this.#cancels.has(id);
  }

  get size(): number {
    this.#prune();
    return this.#records.size;
  }
}

/** Minimal Upstash surface the store uses; a fake stands in for tests. */
export interface RedisLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

const KEY_PREFIX = "arc-prompt-optimizer:run:";

/** Upstash Redis store, shared across instances, with the TTL enforced by Redis. */
export class RedisRunStore implements RunStore {
  readonly #redis: RedisLike;
  readonly #ttlSeconds: number;

  constructor(redis: RedisLike, ttlMs = RUN_TTL_MS) {
    this.#redis = redis;
    this.#ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  }

  async get(id: string): Promise<RunRecord | undefined> {
    return (await this.#redis.get<RunRecord>(`${KEY_PREFIX}${id}`)) ?? undefined;
  }

  async save(record: RunRecord): Promise<void> {
    await this.#redis.set(`${KEY_PREFIX}${record.id}`, record, { ex: this.#ttlSeconds });
  }

  async delete(id: string): Promise<void> {
    await this.#redis.del(`${KEY_PREFIX}${id}`, `${KEY_PREFIX}${id}:cancel`);
  }

  async requestCancel(id: string): Promise<void> {
    await this.#redis.set(`${KEY_PREFIX}${id}:cancel`, 1, { ex: this.#ttlSeconds });
  }

  async cancelRequested(id: string): Promise<boolean> {
    return (await this.#redis.get<number | string>(`${KEY_PREFIX}${id}:cancel`)) !== null;
  }
}

const GLOBAL_KEY = "__arcPromptOptimizerRunStore";

/**
 * Redis when Upstash/KV credentials are set, otherwise one in-process store kept on `globalThis` so every route
 * module in this process sees the same runs.
 */
export function runStoreFor(env: ServerEnv): RunStore {
  const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: RunStore };
  if (holder[GLOBAL_KEY] !== undefined) return holder[GLOBAL_KEY];
  const store =
    env.UPSTASH_REDIS_REST_URL !== undefined && env.UPSTASH_REDIS_REST_TOKEN !== undefined
      ? new RedisRunStore(new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }))
      : new MemoryRunStore();
  holder[GLOBAL_KEY] = store;
  return store;
}

/** The record as returned to clients. Same shape today; kept separate so internal fields can be added later. */
export type RunView = RunRecord;
