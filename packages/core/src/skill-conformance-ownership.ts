import { posix } from "node:path";
import { SKILL_FILE } from "@skillset/registry";
import { parseCurrentGeneratedLock } from "./generated-lock";
import type { RenderedFile } from "./types";

/** Only current supplied lock evidence may distinguish copied resources from primary skills. */
export function skillConformanceAncillaryPaths(
  rendered: readonly RenderedFile[]
): ReadonlySet<string> {
  const byPath = new Map(rendered.map((file) => [normalized(file.path), file]));
  const primarySources = new Map<string, string>();
  const ancillary = new Set<string>();
  for (const file of rendered) {
    // Generated locks have no source file; direct callers may supply source-owned resources.
    if (file.sourcePath !== undefined || posix.basename(normalized(file.path)) !== "skillset.lock") continue;
    const label = `conformance ownership ${file.path}`;
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(file.content)); }
    catch (cause) { throw new Error(`${label}: invalid lock JSON`, { cause }); }
    const lock = parseCurrentGeneratedLock(value, label);
    const root = posix.dirname(normalized(file.path));
    for (const item of lock.items) {
      const paths = item.files.map((path) => posix.join(root, path));
      if (item.kind !== "standalone-skill" && item.kind !== "plugin-skill") continue;
      // Filtered callers may supply a root lock without this unit's projection.
      if (!paths.some((path) => byPath.has(path))) continue;
      if (item.outputPath === undefined) throw new Error(`${label}: skill item has no output anchor`);
      const primaryPath = posix.join(root, item.outputPath);
      if (!paths.includes(primaryPath)) throw new Error(`${label}: anchor ${primaryPath} is not an owned file`);
      if (posix.basename(primaryPath) !== SKILL_FILE) {
        if (paths.some((path) => posix.basename(path) === SKILL_FILE)) {
          throw new Error(`${label}: skill files have a non-skill anchor ${primaryPath}`);
        }
        // Codex delta entries own only auxiliary files, with no primary skill.
        continue;
      }
      const primary = byPath.get(primaryPath);
      const source = item.sourcePath === undefined ? undefined : normalized(item.sourcePath);
      if (source === undefined || primary?.sourcePath === undefined || normalized(primary.sourcePath) !== source) {
        throw new Error(`${label}: primary ${primaryPath} has missing or inconsistent source ownership`);
      }
      const existing = primarySources.get(primaryPath);
      if (existing !== undefined && existing !== source) {
        throw new Error(`${label}: primary ${primaryPath} has conflicting source owners`);
      }
      primarySources.set(primaryPath, source);
      for (const path of paths) if (path !== primaryPath) ancillary.add(path);
    }
  }
  for (const path of primarySources.keys()) {
    if (ancillary.has(path)) throw new Error(`conformance ownership: ${path} is claimed as both primary and ancillary`);
  }
  return new Set([...ancillary].map((path) => byPath.get(path)?.path ?? path));
}

function normalized(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/"));
}
