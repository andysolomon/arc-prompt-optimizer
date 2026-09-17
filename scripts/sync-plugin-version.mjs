#!/usr/bin/env node
// Keeps .claude-plugin/plugin.json in sync with package.json. Runs from the npm `version` lifecycle script,
// which @semantic-release/npm triggers via `npm version`; @semantic-release/git then commits plugin.json.
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const packageUrl = new URL("../package.json", import.meta.url);
const pluginUrl = new URL("../.claude-plugin/plugin.json", import.meta.url);

const { version } = JSON.parse(await readFile(packageUrl, "utf8"));
const plugin = JSON.parse(await readFile(pluginUrl, "utf8"));
if (plugin.version !== version) {
  plugin.version = version;
  await writeFile(pluginUrl, `${JSON.stringify(plugin, null, 2)}\n`);
  process.stdout.write(`Synced .claude-plugin/plugin.json to version ${version}\n`);
}
