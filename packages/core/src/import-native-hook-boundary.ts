import { CLAUDE_PLUGIN_HOOK_CONFIG_REFERENCE, CURSOR_PLUGIN_HOOK_DISCOVERY_REFERENCE } from "@skillset/registry";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readRecord, targetNames } from "./config";
import { compareStrings } from "./path";
import { prepareRepositoryMutationPath } from "./repository-mutation";
import { updateYamlSourceDocument } from "./source-document";
import type { TargetName } from "./types";
import { isJsonRecord, parseYamlRecord } from "./yaml";

const DEFAULT_HOOK_PATH = "hooks/hooks.json";
const SCOPED_HOOK_PATH = "_claude/hooks/hooks.json";

/** Runs only inside the importer's unclaimed staging directory. */
export async function scopeImportedNativeHooks(args: {
  readonly rootPath: string;
  readonly stagingPath: string;
  readonly files: readonly string[];
  readonly targets: readonly TargetName[];
}): Promise<{ readonly files: readonly string[]; readonly hookPath: string; readonly evidence?: string }> {
  const unchanged = { files: args.files, hookPath: DEFAULT_HOOK_PATH };
  if (args.targets.length !== 1 || args.targets[0] !== "claude") return unchanged;
  // Assessment selection is not ownership: all copied manifests survive import.
  for (const target of targetNames()) {
    if (target === "claude") continue;
    try {
      await lstat(join(args.stagingPath, `.${target}-plugin/plugin.json`));
      return unchanged;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  const configPath = join(args.stagingPath, "skillset.yaml");
  const originalConfig = await readFile(configPath, "utf8");
  const config = parseYamlRecord(originalConfig, configPath);
  const metadata = readRecord(config, "skillset") ?? {};
  if (metadata.preprocess === true) return unchanged;
  const claude = readRecord(config, "claude") ?? {};
  const manifest = readRecord(claude, "manifest") ?? {};
  // Additional declarations need a complete component inventory before any
  // relocation can establish that every original hook will still load.
  if (manifest.hooks !== undefined && manifest.hooks !== "./hooks/hooks.json") return unchanged;
  let nativeManifest;
  try {
    nativeManifest = JSON.parse(await readFile(join(args.stagingPath, ".claude-plugin/plugin.json"), "utf8")) as unknown;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  // The importer omits generated component fields from canonical config;
  // inspect the preserved original declaration as well.
  if (isJsonRecord(nativeManifest) && nativeManifest.hooks !== undefined && nativeManifest.hooks !== "./hooks/hooks.json") return unchanged;
  const cursorManifest = readRecord(readRecord(config, "cursor") ?? {}, "manifest") ?? {};
  if (cursorManifest.hooks !== undefined) return unchanged;
  const nativeHookDirectory = join(args.stagingPath, "_claude/hooks");
  try {
    await lstat(nativeHookDirectory);
    throw new Error("skillset: native hook isolation would overwrite _claude/hooks");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  // Do not disable preprocessing for pre-existing authored islands.
  if (metadata.preprocess !== false && args.files.some((path) =>
    targetNames().some((target) => path.startsWith(`_${target}/`))
  )) return unchanged;
  const updatedConfig = updateYamlSourceDocument(originalConfig, configPath, (current) => ({
    ...current, skillset: { ...metadata, preprocess: false },
  }));
  await prepareRepositoryMutationPath(args.rootPath, configPath);
  await prepareRepositoryMutationPath(args.rootPath, nativeHookDirectory);
  // Keep every emitted path, including the config itself: arbitrary native
  // scripts may read their own hooks/hooks.json through the plugin root.
  await rename(join(args.stagingPath, "hooks"), nativeHookDirectory);
  await writeFile(configPath, updatedConfig);
  return {
    files: args.files.map((path) => path.startsWith("hooks/") ? `_claude/${path}` : path).sort(compareStrings),
    hookPath: SCOPED_HOOK_PATH,
    evidence: `${CLAUDE_PLUGIN_HOOK_CONFIG_REFERENCE}; ${CURSOR_PLUGIN_HOOK_DISCOVERY_REFERENCE}`,
  };
}
