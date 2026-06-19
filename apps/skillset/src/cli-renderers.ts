import type { SkillsetDiagnostic, SkillsetDiff } from "@skillset/core";

export function printDiagnostics(diagnostics: readonly SkillsetDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.path ?? diagnostic.outputPath;
    const suffix = location === undefined ? "" : `: ${location}`;
    const prefix = diagnostic.severity === "error" ? "error" : diagnostic.severity === "warning" ? "warning" : "info";
    console.warn(`skillset: ${prefix}${suffix}: ${diagnostic.message}`);
  }
}

export function printDiffPlan(diff: SkillsetDiff, reason: string): void {
  const total = diff.added.length + diff.changed.length + diff.missing.length + diff.removed.length;
  if (total === 0) {
    console.log(`skillset: no generated changes (${reason})`);
    return;
  }
  for (const path of diff.added) console.log(`  + ${path}`);
  for (const path of diff.changed) console.log(`  ~ ${path}`);
  for (const path of diff.missing) console.log(`  ! ${path}`);
  for (const path of diff.removed) console.log(`  - ${path}`);
  console.log(
    `skillset: planned ${diff.added.length} added, ${diff.changed.length} changed, ${diff.missing.length} missing, ${diff.removed.length} removed (${reason})`
  );
  printGeneratedChangelogDriftHint(diff);
}

export function hasGeneratedChangelogDrift(diff: SkillsetDiff): boolean {
  return hasGeneratedChangelogPath([...diff.added, ...diff.changed, ...diff.missing, ...diff.removed]);
}

export function hasGeneratedChangelogPath(paths: readonly string[]): boolean {
  return paths.some((path) => path.endsWith("/CHANGELOG.md") || path === "CHANGELOG.md");
}

export function printGeneratedChangelogDriftHint(diff: SkillsetDiff): void {
  if (!hasGeneratedChangelogDrift(diff)) return;
  printGeneratedChangelogPathHint([...diff.added, ...diff.changed, ...diff.missing, ...diff.removed]);
}

export function printGeneratedChangelogPathHint(paths: readonly string[]): void {
  if (!hasGeneratedChangelogPath(paths)) return;
  console.log(generatedChangelogHint());
}

export function generatedChangelogHint(): string {
  return "skillset: generated CHANGELOG.md files are managed projections; edit pending wording with `skillset change reason <@ref>` before release, `skillset change amend <@ref>` for applied-history wording after release, or `skillset release amend <@ref>` for release-event metadata.";
}
