import { describe, expect, test } from "bun:test";

import { scanGeneratedPublicContent } from "../public-closure-guard";

const GENERATED_SKILL = "plugins/skillset/codex/skills/skillset/SKILL.md";

function rules(
  command: string,
  inline = false,
  aliases: ReadonlySet<string> = new Set()
): readonly string[] {
  const marker = command.includes("`") ? "``" : "`";
  const content = inline
    ? `Run ${marker}${command}${marker}.`
    : `\`\`\`bash\n${command}\n\`\`\``;
  return scanGeneratedPublicContent(
    GENERATED_SKILL,
    content,
    ["scripts/private.ts"],
    aliases,
    undefined,
    "/repo"
  ).map(({ rule }) => rule);
}

function fencedRules(command: string, dialect: string): readonly string[] {
  return scanGeneratedPublicContent(
    GENERATED_SKILL,
    `\`\`\`${dialect}\n${command}\n\`\`\``,
    ["scripts/private.ts"],
    new Set(),
    undefined,
    "/repo"
  ).map(({ rule }) => rule);
}

function expectForShellSurfaces(
  command: string,
  expected: readonly string[]
): void {
  expect(rules(command), `fenced: ${command}`).toEqual(expected);
  expect(rules(command, true), `inline: ${command}`).toEqual(expected);
}

describe("SET-517 nested shell execution", () => {
  test("detects command and process substitutions recursively", () => {
    for (const command of [
      'skillset check "$(cat packages/core/input)"',
      "skillset check $(cat packages/core/input)",
      "skillset check `cat packages/core/input`",
      "skillset check < <(cat packages/core/input)",
      "skillset check > >(tee packages/core/output)",
      "skillset check < <(cat <(cat packages/core/input))",
      `skillset check "$(printf '%s' ')'; cat packages/core/input)"`,
      'skillset check "$(echo "$(cat packages/core/input)")"',
      "skillset check `echo \\`cat packages/core/input\\``",
      'skillset check "$((1 + $(cat packages/core/input)))"',
    ])
      expectForShellSurfaces(command, ["internal-package"]);
  });

  test("applies inner command grammar and caller cwd", () => {
    for (const command of [
      'skillset check "$(rg TODO packages/core)"',
      'env -C public skillset check "$(cat packages/core/input)"',
    ])
      expectForShellSurfaces(command, ["internal-package"]);

    expectForShellSurfaces(
      'skillset check "$(env -C docs cat development/input)"',
      ["development-docs"]
    );
    expectForShellSurfaces('skillset check "$(rg packages public)"', []);
  });

  test("preserves redirect, PATH, HOME, and exact script inventory controls", () => {
    expectForShellSurfaces('skillset check "$(cat < packages/core/input)"', [
      "internal-package",
    ]);
    expectForShellSurfaces('skillset check "$(PATH=packages tool)"', [
      "internal-package",
    ]);
    expectForShellSurfaces('skillset check "$(cat "$HOME/packages/core")"', []);
    expectForShellSurfaces('skillset check "$(scripts/private.ts)"', [
      "internal-script",
    ]);
    expect(
      rules('skillset check "$(bun run private)"', false, new Set(["private"]))
    ).toEqual(["internal-script"]);
    expect(
      rules("skillset check '$(bun run private)'", false, new Set(["private"]))
    ).toEqual([]);
  });

  test("keeps literals, arithmetic, and nested Skillset arguments clean", () => {
    for (const command of [
      "skillset check '$(cat packages/core/input)'",
      String.raw`skillset check \$\(cat packages/core/input\)`,
      String.raw`skillset check \<\(cat packages/core/input\)`,
      String.raw`skillset check \>\(tee packages/core/output\)`,
      'skillset check "$((packages/core + 1))"',
      'skillset check "$((array[packages/core] + 1))" packages/core',
      'skillset check "$(skillset explain packages/core)"',
      "skillset explain packages/core",
    ])
      expectForShellSurfaces(command, []);
  });

  test("resumes outer Skillset context after process substitutions", () => {
    for (const command of [
      "skillset explain <(cat public/input) packages/core",
      "skillset check < <(cat public/input) packages/core",
      "skillset check > >(tee public/output) packages/core",
      "skillset check < <(skillset explain packages/core) packages/core",
    ])
      expectForShellSurfaces(command, []);
  });

  test("distinguishes comments and valid parameter expansion from execution", () => {
    expectForShellSurfaces("skillset check # $(cat packages/core/input)", []);
    expectForShellSurfaces(
      'skillset check "$(echo ${value//\\)/x}; cat packages/core/input)"',
      ["internal-package"]
    );
  });

  test("reports recovered or missing syntax without losing recovered routes", () => {
    expectForShellSurfaces(
      'skillset check "$(echo ${value//)/}; cat packages/core/input)"',
      ["internal-package", "shell-analysis"]
    );
    expectForShellSurfaces('skillset check "$(cat packages/core |)"', [
      "internal-package",
      "shell-analysis",
    ]);
    expect(rules('skillset check "$(cat packages/core/input"')).toEqual([
      "internal-package",
      "shell-analysis",
    ]);
    expect(rules('skillset check "$(cat packages/core/input"', true)).toEqual([
      "shell-analysis",
    ]);
  });

  test("parses multiline substitutions at fenced-statement boundaries", () => {
    const publicResult = scanGeneratedPublicContent(
      GENERATED_SKILL,
      '```bash\nskillset check "$(\n  cat public/input\n)"\n```',
      ["scripts/private.ts"],
      new Set(),
      undefined,
      "/repo"
    );
    const protectedResult = scanGeneratedPublicContent(
      GENERATED_SKILL,
      '```bash\nskillset check "$(\n  cat packages/core/input\n)"\n```',
      ["scripts/private.ts"],
      new Set(),
      undefined,
      "/repo"
    );

    expect(publicResult).toEqual([]);
    expect(protectedResult.map(({ line, rule }) => ({ line, rule }))).toEqual([
      { line: 2, rule: "internal-package" },
    ]);
  });

  test("masks quoted heredoc data but scans unquoted heredoc substitutions", () => {
    const heredoc = (delimiter: string): readonly string[] =>
      scanGeneratedPublicContent(
        GENERATED_SKILL,
        `\`\`\`bash\ncat <<${delimiter}\n$(cat packages/core/input)\nEOF\n\`\`\``,
        ["scripts/private.ts"],
        new Set(),
        undefined,
        "/repo"
      ).map(({ rule }) => rule);

    expect(heredoc('"EOF"')).toEqual([]);
    expect(heredoc("EOF")).toEqual(["internal-package"]);
  });

  test("surfaces the parser reason and source position", () => {
    const [analysis] = scanGeneratedPublicContent(
      GENERATED_SKILL,
      '```bash\nskillset check "$(echo ${value//)/}; cat packages/core/input)"\n```',
      ["scripts/private.ts"],
      new Set(),
      undefined,
      "/repo"
    ).filter(({ rule }) => rule === "shell-analysis");

    expect(analysis?.reason).toBe(
      "parse-error at 2:24: Tree-sitter recovered from unrecognized nested shell syntax"
    );

    const [inline] = scanGeneratedPublicContent(
      GENERATED_SKILL,
      'Run ` skillset check "$(echo ${value//)/}; cat packages/core/input)" `.',
      ["scripts/private.ts"],
      new Set(),
      undefined,
      "/repo"
    ).filter(({ rule }) => rule === "shell-analysis");

    expect(inline?.reason).toBe(
      "parse-error at 1:30: Tree-sitter recovered from unrecognized nested shell syntax"
    );
  });

  test("makes the fence dialect boundary visible", () => {
    expect(
      fencedRules("skillset check <(cat packages/core/input)", "bash")
    ).toEqual(["internal-package"]);
    expect(
      fencedRules("skillset check <(cat packages/core/input)", "sh")
    ).toEqual(["internal-package", "shell-analysis"]);
    expect(
      fencedRules('skillset check "$(cat packages/core/input)"', "zsh")
    ).toEqual(["internal-package", "shell-analysis"]);
  });

  test("deduplicates owner rules across nested execution contexts", () => {
    expectForShellSurfaces(
      'skillset check "$(cat packages/core/a)" "$(cat packages/core/b)"',
      ["internal-package"]
    );
  });
});
