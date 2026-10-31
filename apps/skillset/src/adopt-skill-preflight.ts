import { lstat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { hashSkillDirectory } from "@skillset/core/internal/source-tree-identity";
import { prepareRepositoryMutationPath } from "@skillset/core/internal/repository-mutation";
import { inspectAdoptionSkillRoots, type AdoptionSkillRoot } from "@skillset/core/internal/adoption-managed-skills";
import { isDeepStrictEqual } from "node:util";
import { composeImportedProviderSkill, planImports, type ImportSourcesOptions } from "./import";
import { prepareImportBatch, type PreparedImportBatch } from "./import-prepared-batch";
import type { SetupImportCandidate } from "./setup";

import type { SkillCoalescingDecision } from "@skillset/schema";
export type { SkillCoalescingDecision } from "@skillset/schema";

/** Compare actual normalized destinations, never provider labels or matching directory names. */
export async function preflightAdoptionSkills(
  rootPath: string,
  candidates: readonly SetupImportCandidate[],
  optionsFor: (candidate: SetupImportCandidate) => Promise<ImportSourcesOptions & { readonly sourcePath: string }>,
) {
  const batches = new Map<SetupImportCandidate, PreparedImportBatch | Error>();
  const fingerprints = new Map<string, string>();
  const decisions: SkillCoalescingDecision[] = [];
  const absentDestinations = new Set<string>();
  const display = (path: string) => relative(rootPath, path).replaceAll("\\", "/");
  const dispose = async () => { for (const batch of batches.values()) if (!(batch instanceof Error)) await batch.dispose(); };
  try {
    const roots: AdoptionSkillRoot[] = [];
    for (const candidate of candidates) {
      if (candidate.kind !== "skills") continue;
      try {
        const source = join(rootPath, candidate.path);
        await prepareRepositoryMutationPath(rootPath, join(source, "SKILL.md"), { createParents: false });
        const plan = await planImports(source, "skills");
        roots.push({ path: candidate.path, units: plan.items.map((item) => display(item.sourcePath)) });
      } catch (error) { batches.set(candidate, error instanceof Error ? error : new Error(String(error))); }
    }
    const ownership = await inspectAdoptionSkillRoots(rootPath, roots);
    const managed = ownership.filter((entry) => entry.kind === "managed");
    const excludeSources = new Set(managed.map((entry) => resolve(rootPath, entry.path)));
    for (const entry of managed) {
      const source = resolve(rootPath, entry.sourcePath);
      await prepareRepositoryMutationPath(rootPath, join(source, "SKILL.md"), { createParents: false });
      fingerprints.set(source, await hashSkillDirectory(source));
      decisions.push({ destination: entry.sourcePath, sources: [entry.path, entry.sourcePath], selectedSource: entry.sourcePath, status: "compatible", reason: `Authored source retained: verified current ownership in ${entry.lockPath}, fresh rendering, and complete output bytes/modes agree.` });
    }
    for (const candidate of candidates) {
      if (candidate.kind !== "skills" || batches.has(candidate)) continue;
      try {
        const sourcePath = join(rootPath, candidate.path);
        await prepareRepositoryMutationPath(rootPath, join(sourcePath, "SKILL.md"), { createParents: false });
        fingerprints.set(sourcePath, await hashSkillDirectory(sourcePath));
        batches.set(candidate, await prepareImportBatch({ ...await optionsFor(candidate), excludeSources }));
      } catch (error) { batches.set(candidate, error instanceof Error ? error : new Error(String(error))); }
    }
    const destinations = new Map<string, PreparedImportBatch["units"][number][]>();
    for (const batch of batches.values()) {
      if (batch instanceof Error) continue;
      for (const unit of batch.units) destinations.set(unit.targetPath, [...(destinations.get(unit.targetPath) ?? []), unit]);
    }
    for (const [destination, units] of destinations) {
      const first = units[0]!;
      const sources = units.map((unit) => display(unit.sourcePath));
      const existing = await lstat(destination).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
      if (!existing) absentDestinations.add(destination);
      if (units.length < 2 && !existing) continue;
      try {
        // Accumulate native fields privately so three-way policy conflicts are detected too.
        for (const unit of units.slice(1)) {
          const composed = await composeImportedProviderSkill(first.stagingPath, first.stagingPath, unit.stagingPath);
          await writeFile(join(first.stagingPath, "SKILL.md"), composed.merged);
        }
        if (existing) {
          await prepareRepositoryMutationPath(rootPath, join(destination, "SKILL.md"), { createParents: false });
          fingerprints.set(destination, await hashSkillDirectory(destination));
          await composeImportedProviderSkill(rootPath, destination, first.stagingPath);
        }
        decisions.push({ destination: display(destination), sources, selectedSource: existing ? display(destination) : sources[0]!, status: "compatible", reason: existing ? "Existing authored destination has matching portable content and resources; native fields are compatible." : "Copies have matching portable content and resources with compatible native fields. Stable candidate order retains the first origin; provider ordering does not establish canonical ownership." });
      } catch {
        decisions.push({ destination: display(destination), sources: existing ? [display(destination), ...sources] : sources, status: "conflict", reason: "Selected sources cannot be proven compatible at this destination. Select one reviewed candidate explicitly; no source was written." });
      }
    }
    return {
      batches, decisions, dispose,
      errors: [...ownership.flatMap((entry) => entry.kind === "unknown" ? [{ path: entry.path, message: entry.reason }] : []), ...[...batches.entries()].flatMap(([candidate, batch]) => batch instanceof Error ? [{ path: candidate.path, message: batch.message }] : [])],
      async assertUnchanged() {
        if (!isDeepStrictEqual(ownership, await inspectAdoptionSkillRoots(rootPath, roots))) throw new Error("skillset: managed skill ownership changed after preflight; rerun the preview");
        for (const path of absentDestinations) {
          const present = await lstat(path).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
          if (present) throw new Error(`skillset: adoption destination appeared after preflight: ${display(path)}; rerun the preview`);
        }
        for (const [path, fingerprint] of fingerprints) {
          await prepareRepositoryMutationPath(rootPath, join(path, "SKILL.md"), { createParents: false });
          if (await hashSkillDirectory(path) !== fingerprint) throw new Error(`skillset: adoption input changed after preflight: ${display(path)}; rerun the preview`);
        }
      },
    };
  } catch (error) { await dispose(); throw error; }
}
