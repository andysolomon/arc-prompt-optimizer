import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const PROGRESS_STATUS_KEY = "prompt-optimize";

export type ProgressResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly error: unknown };

/** Minimal loader surface: a cancellable component exposing an abort signal. */
export interface ProgressLoader {
  readonly signal: AbortSignal;
  onAbort: (() => void) | undefined;
}

type CustomFactory = Parameters<ExtensionCommandContext["ui"]["custom"]>[0];
export type ProgressLoaderFactory = (
  tui: Parameters<CustomFactory>[0],
  theme: Parameters<CustomFactory>[1],
  message: string,
) => ProgressLoader;

export type ProgressContext = {
  readonly mode: ExtensionCommandContext["mode"];
  readonly ui: Pick<ExtensionCommandContext["ui"], "custom" | "setStatus" | "notify">;
};

export interface ProgressOptions {
  /** Swappable so tests (and future hosts) need no real TUI component. */
  readonly createLoader?: ProgressLoaderFactory;
}

const defaultLoaderFactory: ProgressLoaderFactory = (tui, theme, message) =>
  new BorderedLoader(tui, theme, message, { cancellable: true });

function settle<T>(value: T | undefined, error: unknown, signal: AbortSignal, failed: boolean): ProgressResult<T> {
  if (signal.aborted) return Object.freeze({ status: "cancelled" });
  if (failed) return Object.freeze({ status: "failed", error });
  return Object.freeze({ status: "completed", value: value as T });
}

/**
 * TUI: shows a cancellable bordered loader; Escape aborts the signal given to `work`.
 * Other dialog hosts: reports progress through status/notify with no interactive cancel.
 */
export async function runWithProgress<T>(
  ctx: ProgressContext,
  message: string,
  work: (signal: AbortSignal) => Promise<T>,
  options: ProgressOptions = {},
): Promise<ProgressResult<T>> {
  if (ctx.mode === "tui") {
    const createLoader = options.createLoader ?? defaultLoaderFactory;
    return await ctx.ui.custom<ProgressResult<T>>((tui, theme, _keybindings, done) => {
      const loader = createLoader(tui, theme, message);
      let finished = false;
      const finish = (result: ProgressResult<T>): void => {
        if (finished) return;
        finished = true;
        done(result);
      };
      loader.onAbort = () => finish(Object.freeze({ status: "cancelled" }));
      work(loader.signal).then(
        (value) => finish(settle(value, undefined, loader.signal, false)),
        (error: unknown) => finish(settle<T>(undefined, error, loader.signal, true)),
      );
      return loader as unknown as ReturnType<CustomFactory> & ProgressLoader;
    });
  }

  const controller = new AbortController();
  ctx.ui.setStatus(PROGRESS_STATUS_KEY, message);
  ctx.ui.notify(message, "info");
  try {
    const value = await work(controller.signal);
    return settle(value, undefined, controller.signal, false);
  } catch (error: unknown) {
    return settle<T>(undefined, error, controller.signal, true);
  } finally {
    ctx.ui.setStatus(PROGRESS_STATUS_KEY, undefined);
  }
}
