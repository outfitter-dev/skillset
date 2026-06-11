import { describe, expect, test } from "bun:test";

import {
  skillEnvVarNoFallbackRule,
  skillFileReferenceEscapeRule,
  skillPreresolveCaseStatementRule,
  skillPreresolveMixedAndOrRule,
  skillPreresolveParameterExpansionRule,
  skillPreresolveQuotedSubstitutionRule,
  skillPreresolveSemicolonRule,
} from "../rules";
import type { LintSubject } from "../types";

const makeSubject = (body: string): LintSubject => ({
  body,
  directoryName: "demo",
  files: ["SKILL.md"],
  frontmatter: { description: "Demo skill.", name: "demo" },
  kind: "skill",
  path: ".skillset/skills/demo/SKILL.md",
  raw: `---\nname: demo\ndescription: Demo skill.\n---\n\n${body}`,
});

describe("skill-file-reference-escape", () => {
  test("flags relative traversal out of the skill directory", () => {
    const diagnostics = skillFileReferenceEscapeRule.check(
      makeSubject("See [schema](../other-skill/references/schema.yaml).")
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-file-reference-escape");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain(
      "../other-skill/references/schema.yaml"
    );
    expect(diagnostics[0]?.guidance?.summary).toContain("self-contained");
  });

  test("flags absolute filesystem paths, including images", () => {
    const diagnostics = skillFileReferenceEscapeRule.check(
      makeSubject(
        "![diagram](/Users/demo/diagram.png) and [doc](/etc/skill/doc.md)"
      )
    );
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "links to /Users/demo/diagram.png, which escapes the skill directory",
      "links to /etc/skill/doc.md, which escapes the skill directory",
    ]);
  });

  test("flags mid-path traversal and dedupes repeats", () => {
    const body =
      "[a](references/../../escape.md) and again [b](references/../../escape.md)";
    expect(skillFileReferenceEscapeRule.check(makeSubject(body))).toHaveLength(
      1
    );
  });

  test("passes skill-local links, URLs, anchors, and resource references", () => {
    const body = [
      "[local](references/guide.md)",
      "[script](./scripts/run.sh)",
      "[site](https://example.com/../up)",
      "[mail](mailto:demo@example.com)",
      "[anchor](#section)",
      "[shared](shared:guides/intro.md)",
    ].join("\n");
    expect(skillFileReferenceEscapeRule.check(makeSubject(body))).toEqual([]);
  });

  test("ignores example links inside fenced code blocks and inline code", () => {
    const body = [
      "```markdown",
      "- [Tenets](../tenets.md) - governing design principles.",
      "```",
      "Inline `[Doc title](../path.md)` example.",
    ].join("\n");
    expect(skillFileReferenceEscapeRule.check(makeSubject(body))).toEqual([]);
  });
});

describe("skill-env-var-no-fallback", () => {
  test("flags a platform placeholder with no fallback on the line", () => {
    const diagnostics = skillEnvVarNoFallbackRule.check(
      makeSubject("Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/setup.py`.")
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-env-var-no-fallback");
    expect(diagnostics[0]?.severity).toBe("warn");
    expect(diagnostics[0]?.message).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(diagnostics[0]?.guidance?.summary).toContain("relative");
  });

  test("flags CODEX placeholders and reports one diagnostic per line", () => {
    const body = "${CODEX_SESSION_ID}\nplain text\n${CLAUDE_SKILL_DIR}";
    expect(skillEnvVarNoFallbackRule.check(makeSubject(body))).toHaveLength(2);
  });

  test("passes lines with a `:-` default or an `||` fallback", () => {
    const body = [
      'bash "${CLAUDE_SKILL_DIR:-.}/scripts/run.sh"',
      'echo "${CLAUDE_PLUGIN_ROOT}" || echo unresolved',
      "no placeholder here",
    ].join("\n");
    expect(skillEnvVarNoFallbackRule.check(makeSubject(body))).toEqual([]);
  });
});

const preresolve = (command: string): string => `Intro.\n\n!\`${command}\`\n`;

describe("skill-preresolve-case-statement", () => {
  test("flags `case ... esac` inside a pre-resolution command", () => {
    const diagnostics = skillPreresolveCaseStatementRule.check(
      makeSubject(preresolve('case "$x" in /*) echo a ;; *) echo b ;; esac'))
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-preresolve-case-statement");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.guidance?.summary).toContain("case ... esac");
  });

  test("ignores case statements outside pre-resolution lines", () => {
    expect(
      skillPreresolveCaseStatementRule.check(
        makeSubject('Run case "$x" in ... esac in a script instead.')
      )
    ).toEqual([]);
  });
});

describe("skill-preresolve-semicolon", () => {
  test("flags a top-level `;` separator", () => {
    const diagnostics = skillPreresolveSemicolonRule.check(
      makeSubject(preresolve("git fetch; git status"))
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-preresolve-semicolon");
    expect(diagnostics[0]?.severity).toBe("error");
  });

  test("passes `;` inside a subshell or quotes", () => {
    for (const command of [
      "(a; b) || echo fallback",
      "echo 'a; b'",
      "git status",
    ]) {
      expect(
        skillPreresolveSemicolonRule.check(makeSubject(preresolve(command)))
      ).toEqual([]);
    }
  });
});

describe("skill-preresolve-mixed-and-or", () => {
  test("flags `A && B || C` at the same depth", () => {
    const diagnostics = skillPreresolveMixedAndOrRule.check(
      makeSubject(preresolve('[ -n "$x" ] && echo yes || echo no'))
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-preresolve-mixed-and-or");
    expect(diagnostics[0]?.guidance?.summary).toContain("(A && B) || C");
  });

  test("passes `(A && B) || C` and single-operator chains", () => {
    for (const command of [
      "(a && b) || echo fallback",
      "a && b && c",
      "cmd 2>/dev/null || echo fallback",
    ]) {
      expect(
        skillPreresolveMixedAndOrRule.check(makeSubject(preresolve(command)))
      ).toEqual([]);
    }
  });
});

describe("skill-preresolve-quoted-substitution", () => {
  test("flags `$(...)` containing a double quote", () => {
    const diagnostics = skillPreresolveQuotedSubstitutionRule.check(
      makeSubject(preresolve('basename "$(dirname "$common")"'))
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe("skill-preresolve-quoted-substitution");
    expect(diagnostics[0]?.guidance?.summary).toContain("script");
  });

  test("passes `$(...)` without inner double quotes", () => {
    expect(
      skillPreresolveQuotedSubstitutionRule.check(
        makeSubject(
          preresolve(
            'cat "$(git rev-parse --show-toplevel 2>/dev/null)/config.yaml" 2>/dev/null || echo none'
          )
        )
      )
    ).toEqual([]);
  });
});

describe("skill-preresolve-parameter-expansion", () => {
  test("flags parameter-expansion operators", () => {
    for (const command of [
      'repo="${common%/.git}"',
      'echo "${repo##*/}"',
      'echo "${var:-fallback}"',
      'echo "${var/foo/bar}"',
    ]) {
      const diagnostics = skillPreresolveParameterExpansionRule.check(
        makeSubject(preresolve(command))
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.rule).toBe("skill-preresolve-parameter-expansion");
    }
  });

  test("passes plain `${VAR}` expansion", () => {
    expect(
      skillPreresolveParameterExpansionRule.check(
        makeSubject(preresolve('echo "${CLAUDE_PLUGIN_ROOT}"'))
      )
    ).toEqual([]);
  });
});
