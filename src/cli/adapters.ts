import { createPiCompletionAdapter, createPiCompletionClientFromRegistry } from "../adapters/pi-completion.js";
import type { CompletionAdapter, CompletionRequest, CompletionResult } from "../core/types.js";
import { hasFlag, type ParsedArgs } from "./args.js";
import { CliError } from "./errors.js";
import { SimulatedCompletionAdapter } from "./simulated-adapter.js";

export interface AdapterSelection {
  readonly adapter: CompletionAdapter;
  readonly mode: "simulate" | "pi";
}

class LiveCompletionAdapter implements CompletionAdapter {
  readonly #inner: CompletionAdapter;

  constructor(inner: CompletionAdapter) {
    this.#inner = inner;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const { fixtureId: _fixtureId, ...liveRequest } = request;
    return await this.#inner.complete(liveRequest, signal);
  }
}

interface PiRuntimeModule {
  readonly createAgentSessionServices?: (options: { readonly cwd: string }) => Promise<{ readonly modelRuntime: unknown }>;
  readonly ModelRegistry?: new (runtime: unknown) => unknown;
}

interface PiRegistryLike {
  getAvailable(): readonly { readonly provider: string; readonly id: string }[];
}

async function createDefaultPiRegistry(cwd: string): Promise<PiRegistryLike> {
  const runtime = (await import("@earendil-works/pi-coding-agent")) as PiRuntimeModule;
  if (typeof runtime.createAgentSessionServices !== "function" || typeof runtime.ModelRegistry !== "function") {
    throw new CliError("INVALID_ARGUMENT", "Pi runtime does not expose the default model registry APIs.");
  }
  const services = await runtime.createAgentSessionServices({ cwd });
  return new runtime.ModelRegistry(services.modelRuntime) as PiRegistryLike;
}

async function createDefaultPiAdapter(defaultModel: string | undefined, cwd: string): Promise<CompletionAdapter> {
  const registry = await createDefaultPiRegistry(cwd);
  const adapter = createPiCompletionAdapter({
    client: createPiCompletionClientFromRegistry(registry as Parameters<typeof createPiCompletionClientFromRegistry>[0]),
    ...(defaultModel === undefined ? {} : { defaultModel }),
  });
  return new LiveCompletionAdapter(adapter);
}

export async function selectAdapter(args: ParsedArgs, cwd: string, defaultModel?: string): Promise<AdapterSelection> {
  if (hasFlag(args, "simulate")) {
    return Object.freeze({ adapter: new SimulatedCompletionAdapter(), mode: "simulate" as const });
  }
  return Object.freeze({ adapter: await createDefaultPiAdapter(defaultModel, cwd), mode: "pi" as const });
}

export async function listDefaultPiModels(cwd: string): Promise<readonly { readonly canonical: string; readonly provider: string; readonly id: string }[]> {
  const registry = await createDefaultPiRegistry(cwd);
  return Object.freeze(
    registry.getAvailable().map((model) =>
      Object.freeze({ canonical: `${model.provider}/${model.id}`, provider: model.provider, id: model.id }),
    ),
  );
}
