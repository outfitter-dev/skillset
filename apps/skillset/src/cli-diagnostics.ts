import type { SkillsetDiagnostic } from "@skillset/core";
import type { SkillsetCliDiagnostic } from "@skillset/schema";

export function serializeDiagnostics(
  diagnostics: readonly SkillsetDiagnostic[]
): readonly SkillsetCliDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.path === undefined && diagnostic.outputPath === undefined
      ? {}
      : { path: diagnostic.path ?? diagnostic.outputPath }),
    severity: diagnostic.severity,
  }));
}
