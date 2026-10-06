import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoSource = fileURLToPath(new URL("../../../src/core/index.ts", import.meta.url));

describe("lib/arc-core", () => {
  it.skipIf(!existsSync(repoSource))("is byte-identical to the repository's src/core and adapters/completion.ts", () => {
    const output = execFileSync(process.execPath, ["scripts/sync-arc-core.mjs", "--check"], { cwd: webRoot, encoding: "utf8" });
    expect(output).toMatch(/files match/u);
  });
});
