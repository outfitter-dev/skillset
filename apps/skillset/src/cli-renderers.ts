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
}
