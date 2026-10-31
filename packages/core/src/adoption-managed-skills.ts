import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { generatedFileModeMatches } from "./generated-file-mode";
import { parseCurrentGeneratedLock, type ParsedGeneratedLockItem } from "./generated-lock";
import { readCurrentGeneratedLockFromDisk } from "./generated-lock-read";
import { isPathInside, resolveInside } from "./path";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import { lstat, readFile, readdir } from "./workspace-fs";
import { withWorkspaceReadBoundary } from "./workspace-read-boundary";

export interface AdoptionSkillRoot {
  readonly path: string;
  readonly units: readonly string[];
}
export type AdoptionSkillOwnership =
  | { readonly path: string; readonly kind: "unmanaged" }
  | { readonly path: string; readonly kind: "managed"; readonly sourcePath: string; readonly lockPath: string }
  | { readonly path: string; readonly kind: "unknown"; readonly reason: string };

/** A lock protects a unit only when its complete current output agrees with a fresh render. */
export async function inspectAdoptionSkillRoots(rootPath: string, roots: readonly AdoptionSkillRoot[]): Promise<readonly AdoptionSkillOwnership[]> {
  if (roots.length === 0) return [];
  const unknown = (path: string, reason: string): AdoptionSkillOwnership => ({ path, kind: "unknown", reason });
  try {
    return await withWorkspaceReadBoundary(rootPath, async () => {
      const exists = async (path: string) => lstat(path).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
      const locksPresent = await Promise.all(roots.map((root) => exists(resolveInside(rootPath, join(root.path, "skillset.lock")))));
      const hasWorkspace = await exists(join(rootPath, "skillset.yaml")) && await exists(join(rootPath, ".skillset"));
      if (!locksPresent.some(Boolean) && !hasWorkspace) return roots.flatMap((root) => root.units.map((path): AdoptionSkillOwnership => ({ path, kind: "unmanaged" })));
      const graph = hasWorkspace ? await loadBuildGraph(rootPath, {}) : undefined;
      // Session settings are not skill ownership; keep their Git probe out of this read-only inspection.
      const files = graph === undefined ? [] : await renderBuildGraph({ ...graph, root: { ...graph.root, compile: { ...graph.root.compile, sessionStartHook: "off" } } });
      const rendered = new Map(files.map((file) => [file.path, file]));
      const results: AdoptionSkillOwnership[] = [];
      for (const root of roots) {
        const lockPath = join(root.path, "skillset.lock").replaceAll("\\", "/");
        try {
          const stored = await readCurrentGeneratedLockFromDisk(resolveInside(rootPath, lockPath), { expectedOutputRoot: root.path, logicalPath: lockPath, missing: "absent", provenance: "require" });
          const freshFile = rendered.get(lockPath);
          const fresh = freshFile === undefined ? undefined : parseCurrentGeneratedLock(JSON.parse(new TextDecoder().decode(freshFile.content)), lockPath, { provenance: "require" });
          const storedItems = stored.kind === "absent" ? [] : stored.lock.items;
          const freshItems = fresh?.items ?? [];
          const anchor = (item: ParsedGeneratedLockItem) => item.outputPath === undefined ? undefined : join(root.path, item.outputPath).replaceAll("\\", "/");
          // Include claimed units whose primary file disappeared, not just what discovery can still see.
          const paths = new Set(root.units);
          for (const item of [...storedItems, ...freshItems]) {
            const path = anchor(item);
            if ((item.kind === "standalone-skill" || item.kind === "plugin-skill") && path !== undefined && basename(path) === "SKILL.md") paths.add(dirname(path));
          }
          for (const path of paths) {
            const primary = join(path, "SKILL.md").replaceAll("\\", "/");
            const claims = (items: readonly ParsedGeneratedLockItem[]) => items.filter((item) => item.files.some((file) => isPathInside(path, join(root.path, file), { allowEqual: false })));
            const prior = claims(storedItems);
            const current = claims(freshItems);
            if (prior.length === 0 && current.length === 0) {
              results.push({ path, kind: "unmanaged" });
              continue;
            }
            const item = current[0];
            if (prior.length !== 1 || current.length !== 1 || item === undefined || !isDeepStrictEqual(item, prior[0]) || anchor(item) !== primary || !item.sourcePath || (item.kind !== "standalone-skill" && item.kind !== "plugin-skill")) {
              results.push(unknown(path, `Stored and fresh ownership do not uniquely agree at ${lockPath}.`));
              continue;
            }
            const expected = item.files.map((file) => join(root.path, file).replaceAll("\\", "/")).sort();
            try {
              const sourcePath = dirname(item.sourcePath);
              if (sourcePath === path || !(await lstat(resolveInside(rootPath, item.sourcePath))).isFile()) throw new Error("Authored source is unavailable.");
              const actual = await unitFiles(rootPath, path);
              if (!isDeepStrictEqual(actual, expected)) throw new Error("Generated unit has missing or unaccounted files.");
              for (const output of expected) {
                const file = rendered.get(output);
                if (file === undefined) throw new Error(`No fresh output for ${output}.`);
                const absolute = resolveInside(rootPath, output);
                const stats = await lstat(absolute);
                if (!stats.isFile() || !generatedFileModeMatches(stats.mode, file.mode) || !Buffer.from(await readFile(absolute)).equals(Buffer.from(file.content))) throw new Error(`Generated bytes or mode differ at ${output}.`);
              }
              results.push({ path, kind: "managed", sourcePath, lockPath });
            } catch (error) { results.push(unknown(path, error instanceof Error ? error.message : String(error))); }
          }
        } catch (error) { results.push(unknown(root.path, error instanceof Error ? error.message : String(error))); }
      }
      return results;
    });
  } catch (error) {
    return roots.map((root) => unknown(root.path, error instanceof Error ? error.message : String(error)));
  }
}

async function unitFiles(rootPath: string, path: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(resolveInside(rootPath, path), { withFileTypes: true })) {
    const child = join(path, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) files.push(...await unitFiles(rootPath, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Unsupported generated entry: ${child}`);
  }
  return files.sort();
}
