import type { LintDiagnostic, LintRule } from "../types";

/**
 * The Skillset resolver prefers frontmatter `name` over the directory name when
 * deriving the skill id (apps/skillset resolver), so a mismatch silently
 * renames the generated skill away from its source directory. Harness plugin
 * validators additionally require the two to agree.
 */
export const skillNameDirectoryMismatchRule: LintRule = {
  check: (subject): readonly LintDiagnostic[] => {
    const { name } = subject.frontmatter;
    if (typeof name !== "string" || name === "") {
      return [];
    }
    if (name === subject.directoryName) {
      return [];
    }
    return [
      {
        guidance: {
          summary:
            "Rename the skill directory or the frontmatter name so they match; mismatches silently rename the generated skill.",
        },
        message: `frontmatter name ${name} does not match skill directory ${subject.directoryName}`,
        path: subject.path,
        rule: "skill-name-directory-mismatch",
        severity: "error",
      },
    ];
  },
  description: "Frontmatter name must match the skill directory name.",
  name: "skill-name-directory-mismatch",
  severity: "error",
};
