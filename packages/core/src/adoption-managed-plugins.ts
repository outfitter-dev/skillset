import { isEmptySourceGraphError } from "./empty-source-graph";
import { dirname, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { generatedFileModeMatches } from "./generated-file-mode";
import { parseCurrentGeneratedLock, type ParsedGeneratedLockItem } from "./generated-lock";
import { readCurrentGeneratedLockFromDisk } from "./generated-lock-read";
import { isPathInside, resolveInside } from "./path";
import { pluginBundleRoot } from "./plugin-output";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import { targetNames } from "./targets";
import { lstat, readFile, readdir } from "./workspace-fs";
import { withWorkspaceReadBoundary } from "./workspace-read-boundary";

export type AdoptionPluginOwnership =
  | { readonly path: string; readonly kind: "unmanaged" }
  | { readonly path: string; readonly kind: "managed"; readonly sourcePath: string; readonly lockPaths: readonly string[]; readonly evidence: string }
  | { readonly path: string; readonly kind: "unknown"; readonly reason: string };

/** Verify the complete package, including separate manifest, provider and child-skill owners. */
export async function inspectAdoptionPluginPackages(rootPath: string, candidates: readonly string[]): Promise<readonly AdoptionPluginOwnership[]> {
  const paths = new Set(candidates);
  const unknown = (path: string, error: unknown): AdoptionPluginOwnership => ({ path, kind: "unknown", reason: error instanceof Error ? error.message : String(error) });
  try {
    return await withWorkspaceReadBoundary(rootPath, async () => {
      const exists = async (path: string) => lstat(resolveInside(rootPath, path)).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
      const hasWorkspace = await exists("skillset.yaml") && await exists(".skillset");
      const graph = hasWorkspace ? await loadBuildGraph(rootPath, {}).catch((error) => { if (isEmptySourceGraphError(error)) return undefined; throw error; }) : undefined;
      const files = graph === undefined ? [] : await renderBuildGraph({ ...graph, root: { ...graph.root, compile: { ...graph.root.compile, sessionStartHook: "off" } } });
      const rendered = new Map(files.map((file) => [file.path, file]));
      const lockPaths = new Set<string>();
      const freshLocks = new Map<string, readonly ParsedGeneratedLockItem[]>();
      for (const file of files) {
        if (file.path !== "skillset.lock" && !file.path.endsWith("/skillset.lock")) continue;
        const lock = parseCurrentGeneratedLock(JSON.parse(new TextDecoder().decode(file.content)), file.path, { provenance: "require" });
        if (lock.items.some((item) => item.kind === "plugin" || item.kind === "plugin-skill")) {
          freshLocks.set(file.path, lock.items);
          lockPaths.add(file.path);
        }
      }
      // Fresh roots also expose a package whose last discoverable manifest disappeared.
      for (const plugin of graph?.plugins ?? []) {
        for (const target of targetNames()) {
          const path = pluginBundleRoot(graph!.root.outputs.plugins[target], target, plugin);
          if (files.some((file) => isPathInside(path, file.path, { allowEqual: false }))) paths.add(path);
        }
      }
      for (const path of paths) {
        let parent = path;
        for (;;) {
          const lockPath = join(parent, "skillset.lock");
          if (await exists(lockPath)) lockPaths.add(lockPath);
          if (parent === ".") break;
          parent = dirname(parent);
        }
      }
      const locks = await Promise.all([...lockPaths].sort().map(async (path) => {
        try {
          const stored = await readCurrentGeneratedLockFromDisk(resolveInside(rootPath, path), { expectedOutputRoot: dirname(path), logicalPath: path, missing: "absent", provenance: "require" });
          return { path, prior: stored.kind === "absent" ? [] : stored.lock.items, current: freshLocks.get(path) ?? [] };
        } catch (error) { return { path, prior: [], current: freshLocks.get(path) ?? [], error }; }
      }));
      const results: AdoptionPluginOwnership[] = [];
      for (const path of [...paths].sort()) {
        try {
          const relevant = locks.filter((lock) => isPathInside(dirname(lock.path), path, { allowEqual: true }));
          const claims = (items: readonly ParsedGeneratedLockItem[], lockPath: string) => items.filter((item) => item.files.some((file) => isPathInside(path, join(dirname(lockPath), file), { allowEqual: false })));
          const entries = relevant.map((lock) => ({ ...lock, prior: claims(lock.prior, lock.path), current: claims(lock.current, lock.path) }));
          if (entries.some((entry) => entry.error !== undefined)) throw new Error("An enclosing generated lock cannot be validated.");
          if (entries.every((entry) => entry.prior.length === 0 && entry.current.length === 0)) { results.push({ path, kind: "unmanaged" }); continue; }
          if (path === ".") throw new Error("Workspace-root package ownership needs an explicit package boundary.");
          if (entries.some((entry) => !isDeepStrictEqual(entry.prior, entry.current))) throw new Error("Stored and fresh package ownership differ.");
          const items = entries.flatMap((entry) => entry.current);
          const identities = new Set(items.filter((item) => item.kind === "plugin").map((item) => item.name));
          const plugin = graph?.plugins.find((plugin) => identities.size === 1 && identities.has(plugin.id));
          if (plugin === undefined) throw new Error("Package does not resolve to one canonical plugin.");
          const sourcePath = relative(rootPath, plugin.path).replaceAll("\\", "/");
          const skills = new Set((plugin.discoveredSkills ?? plugin.skills).map((skill) => relative(rootPath, skill.sourcePath).replaceAll("\\", "/")));
          const sourceRelative = (path: string) => relative(rootPath, path).replaceAll("\\", "/");
          const belongsToPlugin = (item: ParsedGeneratedLockItem): boolean => {
            if (item.kind === "plugin") return item.name === plugin.id && item.sourcePath === sourcePath;
            if (item.plugin !== plugin.id) return false;
            if (item.kind === "plugin-skill") return skills.has(item.sourcePath ?? "");
            if (item.kind === "plugin-feature") return plugin.features.some((feature) => item.feature === feature.key && item.name === `${plugin.id}:${feature.key}` && item.sourcePath === sourceRelative(feature.sourcePath) && item.sourcePointer === feature.sourcePointer);
            if (item.kind === "island") return graph!.projectIslands.some((island) => island.plugin === plugin.id && item.sourcePath === sourceRelative(island.sourcePath) && item.name === `${island.target}:${plugin.id}:${island.relativePath}`);
            return false;
          };
          if (!items.every(belongsToPlugin)) throw new Error("Package includes unrelated or unresolved source ownership.");
          const expected = entries.flatMap((entry) => entry.current.flatMap((item) => item.files.map((file) => join(dirname(entry.path), file)))).sort();
          if (expected.some((file) => !isPathInside(path, file, { allowEqual: false })) || new Set(expected).size !== expected.length) throw new Error("Package ownership crosses its boundary or overlaps.");
          const actual = await packageFiles(rootPath, path);
          if (!isDeepStrictEqual(actual, expected)) throw new Error("Package has missing or unaccounted files.");
          for (const output of expected) {
            const file = rendered.get(output);
            const absolute = resolveInside(rootPath, output);
            const stats = await lstat(absolute);
            if (file === undefined || !stats.isFile() || !generatedFileModeMatches(stats.mode, file.mode) || !Buffer.from(await readFile(absolute)).equals(Buffer.from(file.content))) throw new Error(`Generated bytes or mode differ at ${output}.`);
          }
          // Current item records include source/output digests; retain them for revalidation.
          results.push({ path, kind: "managed", sourcePath, lockPaths: entries.filter((entry) => entry.current.length > 0).map((entry) => entry.path), evidence: JSON.stringify(entries.map((entry) => ({ path: entry.path, items: entry.current }))) });
        } catch (error) { results.push(unknown(path, error)); }
      }
      return results;
    });
  } catch (error) { return [...paths].map((path) => unknown(path, error)); }
}

async function packageFiles(rootPath: string, path: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(resolveInside(rootPath, path), { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await packageFiles(rootPath, child);
      if (nested.length === 0) throw new Error(`Unaccounted empty package directory: ${child}`);
      files.push(...nested);
    } else if (entry.isFile()) files.push(child);
    else throw new Error(`Unsupported package entry: ${child}`);
  }
  return files.sort();
}
