import { basename, isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readString } from "./config";
import { parseCurrentGeneratedLock, type ParsedGeneratedLockItem } from "./generated-lock";
import { readCurrentGeneratedLockFromDisk } from "./generated-lock-read";
import { logicalDiagnosticPath, resolveInside } from "./path";
import { renderBuildGraph } from "./render";
import { PROJECT_SESSION_START_TARGETS, projectSessionStartPath } from "./render-project-hooks";
import { loadBuildGraph } from "./resolver";
import { realpath, stat } from "./workspace-fs";
import { prepareWorkspaceRead, withWorkspaceReadBoundary } from "./workspace-read-boundary";

export type GeneratedEditOwnership =
  | { readonly kind: "unknown" }
  | {
      readonly kind: "managed";
      readonly outputPath: string;
      readonly sourcePath: string;
      readonly sourceKind: "file" | "directory";
    };

const UNKNOWN: GeneratedEditOwnership = { kind: "unknown" };

/**
 * Authorize only full-file ownership that agrees with both a current render and
 * the stored managed baseline. Output edits do not relinquish that ownership.
 * Every incomplete inspection is a no-decision result for a pre-edit hook.
 */
export async function inspectGeneratedEditOwnership(
  rootPath: string,
  targetPath: string
): Promise<GeneratedEditOwnership> {
  if (!isAbsolute(targetPath)) return UNKNOWN;
  try {
    return await withWorkspaceReadBoundary(rootPath, async (): Promise<GeneratedEditOwnership> => {
      const root = await realpath(rootPath);
      const target = await prepareWorkspaceRead(targetPath);
      const graph = await loadBuildGraph(root, {});
      if (graph.nativeRootRuleSource !== undefined && target === join(root, "AGENTS.md")) return UNKNOWN;
      // Hook settings can transition between full islands and partial entries.
      // They are excluded even when the recorded baseline currently owns all bytes.
      for (const provider of PROJECT_SESSION_START_TARGETS) {
        const projectRoot = readString(graph.root.targets[provider].options, "projectRoot") ?? `.${provider}`;
        if (resolveInside(root, projectSessionStartPath(provider, projectRoot)) === target) return UNKNOWN;
      }
      // Non-settings ownership is independent of session-hook placement. Avoid
      // its Git ignore probe; do not infer a hook decision from this render.
      const rendered = await renderBuildGraph({
        ...graph,
        root: { ...graph.root, compile: { ...graph.root.compile, sessionStartHook: "off" } },
      });
      const fresh: ParsedGeneratedLockItem[] = [];
      const stored: ParsedGeneratedLockItem[] = [];
      for (const file of rendered) {
        if (basename(file.path) !== "skillset.lock" || file.sourcePath !== undefined) continue;
        const lock = parseCurrentGeneratedLock(
          JSON.parse(new TextDecoder().decode(file.content)), file.path, { provenance: "require" }
        );
        const matches = (item: ParsedGeneratedLockItem) => item.files.some(
          (path) => resolveInside(root, join(lock.outputRoot, path)) === target
        );
        fresh.push(...lock.items.filter(matches));
        const prior = await readCurrentGeneratedLockFromDisk(resolveInside(root, file.path), {
          expectedOutputRoot: lock.outputRoot,
          logicalPath: file.path,
          missing: "absent",
          provenance: "require",
        });
        if (prior.kind === "present") stored.push(...prior.lock.items.filter(matches));
      }
      // Count claims before excluding partial ownership or comparing identities.
      if (fresh.length !== 1 || stored.length !== 1) return UNKNOWN;
      const item = fresh[0]!;
      if ([item, stored[0]!].some((claim) => claim.kind === "settings-entry" || (claim.ownedEntries?.length ?? 0) > 0)) return UNKNOWN;
      if (!isDeepStrictEqual(item, stored[0]) || !item.sourcePath) return UNKNOWN;
      const source = resolveInside(root, item.sourcePath);
      if (source === target) return UNKNOWN;
      const sourceEntry = await stat(source);
      if (!sourceEntry.isFile() && !sourceEntry.isDirectory()) return UNKNOWN;
      return {
        kind: "managed",
        outputPath: logicalDiagnosticPath(root, target),
        sourcePath: item.sourcePath,
        sourceKind: sourceEntry.isDirectory() ? "directory" : "file",
      };
    });
  } catch {
    return UNKNOWN;
  }
}
