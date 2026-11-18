import { CLAUDE_PLUGIN_HOOK_CONFIG_REFERENCE, CURSOR_PLUGIN_HOOK_DISCOVERY_REFERENCE } from "@skillset/registry";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readRecord, targetNames } from "./config";
import { inventoryClaudeHookDeclaration, type ImportedNativeHookSource } from "./import-native-hook-declarations";
import { compareStrings } from "./path";
import { prepareRepositoryMutationPath } from "./repository-mutation";
import { updateYamlSourceDocument } from "./source-document";
import type { JsonRecord, TargetName } from "./types";
import { isJsonRecord, parseYamlRecord } from "./yaml";

export interface ImportedNativeHookBoundary {
  readonly files: readonly string[];
  readonly sources: readonly ImportedNativeHookSource[];
  readonly evidence?: string;
}

/** Runs only inside the importer's unclaimed staging directory. */
export async function scopeImportedNativeHooks(args: {
  readonly rootPath: string;
  readonly stagingPath: string;
  readonly files: readonly string[];
  readonly targets: readonly TargetName[];
  readonly synthesizedConfig: boolean;
}): Promise<ImportedNativeHookBoundary> {
  const defaultPath = "hooks/hooks.json";
  const defaultSources = args.files.includes(defaultPath) ? [{ path: defaultPath, originalPath: defaultPath }] : [];
  const unchanged = { files: args.files, sources: defaultSources };
  let nativeManifest: JsonRecord | undefined;
  try {
    const parsed = JSON.parse(await readFile(join(args.stagingPath, ".claude-plugin/plugin.json"), "utf8")) as unknown;
    if (isJsonRecord(parsed)) nativeManifest = parsed;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const declaration = nativeManifest?.hooks;
  const additional = declaration !== undefined && declaration !== "./hooks/hooks.json";
  // Authored canonical config remains authoritative; this inventory belongs to
  // native-manifest synthesis, not a reinterpretation of existing source.
  if (additional && !args.synthesizedConfig) return unchanged;
  const cannotScope = (): ImportedNativeHookBoundary => {
    if (additional) throw new Error("skillset: additional Claude hook declarations require explicit source configuration; automatic import cannot establish sole native ownership without changing authored preprocessing. Original files are unchanged and no destination was claimed.");
    return unchanged;
  };
  if (args.targets.length !== 1 || args.targets[0] !== "claude") return cannotScope();
  // Assessment selection is not ownership: all copied manifests survive import.
  for (const target of targetNames()) {
    if (target === "claude") continue;
    if (await exists(join(args.stagingPath, `.${target}-plugin/plugin.json`))) return cannotScope();
  }
  const configPath = join(args.stagingPath, "skillset.yaml");
  const originalConfig = await readFile(configPath, "utf8");
  const config = parseYamlRecord(originalConfig, configPath);
  const metadata = readRecord(config, "skillset") ?? {};
  if (metadata.preprocess === true) return cannotScope();
  const manifest = readRecord(readRecord(config, "claude") ?? {}, "manifest") ?? {};
  if (additional && !isDeepStrictEqual(manifest.hooks, declaration)) throw new Error("skillset: native and canonical Claude hook declarations disagree");
  if (!additional && manifest.hooks !== undefined && manifest.hooks !== "./hooks/hooks.json") return unchanged;
  const cursorManifest = readRecord(readRecord(config, "cursor") ?? {}, "manifest") ?? {};
  if (cursorManifest.hooks !== undefined) return cannotScope();
  const sources = await inventoryClaudeHookDeclaration(args.stagingPath, declaration, args.files);
  if (sources.length === 0) return unchanged;
  const filePaths = sources.filter((source) => source.pointers === undefined).map((source) => source.path);
  const moveHooks = filePaths.some((path) => path.startsWith("hooks/"));
  const moves = [...(moveHooks ? ["hooks"] : []), ...filePaths.filter((path) => !moveHooks || !path.startsWith("hooks/"))];
  for (const path of moves) {
    for (const target of targetNames()) {
      if (await exists(join(args.stagingPath, `_${target}`, path))) throw new Error(`skillset: native hook isolation would overwrite _${target}/${path}`);
    }
  }
  // Do not disable preprocessing for pre-existing authored islands.
  if (moves.length > 0 && metadata.preprocess !== false && args.files.some((path) => targetNames().some((target) => path.startsWith(`_${target}/`)))) return cannotScope();
  const scopedPath = (path: string) => moves.some((move) => path === move || path.startsWith(`${move}/`)) ? `_claude/${path}` : path;
  if (moves.length > 0) {
    const updatedConfig = updateYamlSourceDocument(originalConfig, configPath, (current) => ({ ...current, skillset: { ...metadata, preprocess: false } }));
    await prepareRepositoryMutationPath(args.rootPath, configPath);
    for (const path of moves) {
      const destination = join(args.stagingPath, "_claude", path);
      await prepareRepositoryMutationPath(args.rootPath, destination);
      // Keep emitted paths: native scripts may read their own config files.
      await rename(join(args.stagingPath, path), destination);
    }
    await writeFile(configPath, updatedConfig);
  }
  return {
    files: args.files.map(scopedPath).sort(compareStrings),
    sources: sources.map((source) => ({ ...source, path: scopedPath(source.path) })).sort((a, b) => compareStrings(a.path, b.path)),
    evidence: `${CLAUDE_PLUGIN_HOOK_CONFIG_REFERENCE}; ${CURSOR_PLUGIN_HOOK_DISCOVERY_REFERENCE}`,
  };
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}
