type BufferEncoding = "utf8";

declare const Buffer: {
  byteLength(text: string, encoding: BufferEncoding): number;
};

declare module "node:fs" {
  export function createReadStream(
    path: string | URL,
    options?: { readonly encoding?: BufferEncoding; readonly highWaterMark?: number },
  ): ReadableLike;
}

declare module "node:fs/promises" {
  export function readFile(path: string | URL, encoding: BufferEncoding): Promise<string>;
  export function writeFile(path: string | URL, data: string, encoding?: BufferEncoding): Promise<void>;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
}

declare module "node:timers/promises" {
  export function setTimeout(milliseconds: number, value?: undefined, options?: { readonly signal?: AbortSignal }): Promise<void>;
}

declare module "node:process" {
  const process: Process;
  export default process;
}

interface ReadableLike {
  readonly isTTY?: boolean;
  destroy?(error?: Error): void;
  setEncoding(encoding: BufferEncoding): void;
  on(event: "data", listener: (chunk: string) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

interface WritableLike {
  write(data: string, callback?: (error?: Error | null) => void): boolean;
}

interface Process {
  readonly argv: readonly string[];
  readonly cwd: () => string;
  readonly stdin: ReadableLike;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  exitCode?: number;
}
