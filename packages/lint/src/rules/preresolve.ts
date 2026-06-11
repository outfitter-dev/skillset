import {
  findCommandSubstitutions,
  hasTopLevelMixedAndOr,
  hasTopLevelSemicolon,
} from "../shell";
import type { LintDiagnostic, LintRule, LintSubject } from "../types";

/**
 * Claude Code runs `` !`command` `` pre-resolution placeholders through its
 * shell safety check at skill-load time. Several bash shapes are rejected
 * outright, failing the skill before its body ever runs. Each rule below
 * targets one rejected shape, ported from the incidents documented in
 * compound-engineering-plugin's tests/skill-shell-safety.test.ts.
 */

interface PreResolutionCommand {
  readonly command: string;
  readonly line: number;
}

/**
 * Lines whose trimmed content is a single inline pre-resolution command:
 * starts with `` !` `` and ends with a closing backtick.
 */
const findPreResolutionCommands = (
  body: string
): readonly PreResolutionCommand[] => {
  const commands: PreResolutionCommand[] = [];
  for (const [index, raw] of body.split(/\r?\n/u).entries()) {
    const trimmed = raw.trim();
    if (!(trimmed.startsWith("!`") && trimmed.endsWith("`"))) {
      continue;
    }
    const command = trimmed.slice(2, -1);
    if (command === "") {
      continue;
    }
    commands.push({ command, line: index + 1 });
  }
  return commands;
};

interface PreresolveRuleSpec {
  readonly description: string;
  readonly guidance: string;
  readonly name: string;
  readonly offends: (command: string) => boolean;
  readonly reason: string;
}

const makePreresolveRule = (spec: PreresolveRuleSpec): LintRule => ({
  check: (subject: LintSubject): readonly LintDiagnostic[] =>
    findPreResolutionCommands(subject.body)
      .filter(({ command }) => spec.offends(command))
      .map(({ command }) => ({
        guidance: { summary: spec.guidance },
        message: `pre-resolution command ${spec.reason}: \`${command}\``,
        path: subject.path,
        rule: spec.name,
        severity: "error",
      })),
  description: spec.description,
  name: spec.name,
  severity: "error",
});

const CASE_STATEMENT_PATTERN = /\bcase\b[\s\S]*\besac\b/u;

export const skillPreresolveCaseStatementRule: LintRule = makePreresolveRule({
  description:
    "Pre-resolution commands must not contain case statements; Claude Code's safety check rejects them.",
  guidance:
    "Claude Code rejects `case ... esac` in `!` pre-resolution commands. Use `if`/`&&`/`||` chaining or extract the logic to a script invoked from the skill body.",
  name: "skill-preresolve-case-statement",
  offends: (command) => CASE_STATEMENT_PATTERN.test(command),
  reason: "contains a `case ... esac` statement",
});

export const skillPreresolveSemicolonRule: LintRule = makePreresolveRule({
  description:
    "Pre-resolution commands must not use top-level `;` separators; Claude Code's safety check rejects them.",
  guidance:
    "Claude Code rejects `;` command separators in `!` pre-resolution commands. Chain with `&&`/`||`, wrap the statements in a `(...)` subshell, or extract to a script.",
  name: "skill-preresolve-semicolon",
  offends: hasTopLevelSemicolon,
  reason: "uses a top-level `;` separator",
});

export const skillPreresolveMixedAndOrRule: LintRule = makePreresolveRule({
  description:
    "Pre-resolution commands must not mix `&&` and `||` at the same depth; Claude Code rejects the shape as ambiguous.",
  guidance:
    'Claude Code rejects the `A && B || C` shape as "ambiguous syntax with command separators". Wrap the `&&` chain in a subshell so only `||` remains at top level: `(A && B) || C`.',
  name: "skill-preresolve-mixed-and-or",
  offends: hasTopLevelMixedAndOr,
  reason: "mixes `&&` and `||` at the same depth",
});

export const skillPreresolveQuotedSubstitutionRule: LintRule =
  makePreresolveRule({
    description:
      "Pre-resolution commands must not nest double-quoted strings inside `$(...)`; Claude Code rejects the shape.",
    guidance:
      'Claude Code rejects `$(...)` containing a double-quoted string as "Unhandled node type: string" (e.g. `basename "$(dirname "$common")"`). Extract the logic to a script invoked from the skill body.',
    name: "skill-preresolve-quoted-substitution",
    offends: (command) =>
      findCommandSubstitutions(command).some((inner) => inner.includes('"')),
    reason: "nests a double-quoted string inside `$(...)`",
  });

/** `${VAR` followed by a parameter-expansion operator; plain `${VAR}` is fine. */
const PARAMETER_EXPANSION_PATTERN = /\$\{[A-Za-z_][A-Za-z0-9_]*[%#:/^,@-]/u;

export const skillPreresolveParameterExpansionRule: LintRule =
  makePreresolveRule({
    description:
      "Pre-resolution commands must not use bash parameter-expansion operators; Claude Code rejects them.",
    guidance:
      'Claude Code rejects parameter-expansion operators (`${var%pat}`, `${var##pat}`, `${var:-default}`, ...) as "Contains expansion". Use simple `${var}` only, or extract the logic to a script invoked from the skill body.',
    name: "skill-preresolve-parameter-expansion",
    offends: (command) => PARAMETER_EXPANSION_PATTERN.test(command),
    reason: "uses a bash parameter-expansion operator",
  });
