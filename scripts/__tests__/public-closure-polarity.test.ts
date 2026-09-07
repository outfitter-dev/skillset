import { describe, expect, test } from "bun:test";

import { scanGeneratedPublicContent } from "../public-closure-guard";

function rules(command: string): readonly string[] {
  return scanGeneratedPublicContent(
    "plugins/skillset/codex/skills/skillset/SKILL.md",
    `\`\`\`sh\n${command}\n\`\`\``,
    ["scripts/private.ts"],
    new Set(),
    undefined,
    "/repo"
  ).map(({ rule }) => rule);
}

describe("SET-489 default shell operand policy", () => {
  test("closes eight historical finding classes structurally", () => {
    for (const command of [
      "git --work-tree packages status", // 1: directory options
      'cat "$PWD/packages/core"', // 2: variable expansions
      "fd TODO packages", // 3: search roots
      "cat https://github.com/outfitter-dev/skillset/commits/main/packages/core", // 5: repository URL suffixes
      "env --chdir packages pwd", // 6: wrapper cwd
      'cat "$(pwd)/packages/core"', // 7: working-directory substitutions
      "git --git-dir packages/.git status", // 8: repository-directory options
      "cp README.md --target-directory=packages", // 9: attached operands
    ])
      expect(rules(command)).toEqual(["internal-package"]);
  });

  test("command and flag omissions conservatively expose protected operands", () => {
    for (const command of [
      "make -C packages",
      "make --directory=packages",
      "bat packages",
      "rg --future packages public",
      "fd --future packages public",
      "unknown-tool packages",
      "unknown-tool --future=packages",
      "unknown-tool -Xpackages",
      "cp -rtpackages README.md",
      "ln -t packages README.md",
      "install --target-directory=packages README.md",
      "sudo --future packages ls",
      "export TARGET=packages",
      "npm --future-path packages install",
      "npm --future-path=packages install",
      "npm run build -- --prefix packages",
    ])
      expect(rules(command)).toEqual(["internal-package"]);
    expect(rules("git -Cscripts status")).toEqual(["internal-script"]);
    expect(rules("rg --future=scripts TODO public")).toEqual([
      "internal-script",
    ]);
  });

  test("keeps known non-path positions and public plugin paths clean", () => {
    for (const command of [
      "bun --eval packages",
      "bun --print fixtures",
      "bun -e packages",
      "bun -p fixtures",
      "echo packages",
      "printf fixtures",
      "rg packages public",
      "rg -g packages TODO public",
      "sudo -u packages ls public",
      "env LABEL=packages pwd",
      "env -S packages",
      "pnpm --filter packages run build",
      "npm --loglevel packages install",
      "skillset explain packages",
      "skillset explain packages/core",
      "skillset explain scripts/private.ts",
      "skillset explain $REPO_ROOT/packages/core",
      "skillset explain https://github.com/outfitter-dev/skillset/blob/main/packages/core",
      "unknown-tool --future=scripts/check.sh",
      'cat "${CLAUDE_PLUGIN_ROOT}/scripts/check.sh"',
      "cat scripts/check.sh",
      'cat "$HOME/packages/core"',
    ])
      expect(rules(command)).toEqual([]);
    expect(rules("unknown-tool --future=scripts")).toEqual(["internal-script"]);
    expect(rules("unknown-tool --future=scripts/private.ts")).toEqual([
      "internal-script",
    ]);
  });

  test("the skillset exemption preserves surrounding command routes", () => {
    expect(rules("skillset explain packages/core; make -C packages")).toEqual([
      "internal-package",
    ]);
    expect(rules("env -C packages skillset explain packages/core")).toEqual([
      "internal-package",
    ]);
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "Use `skillset explain packages/core` for your source. Then run `make -C packages`."
      ).map(({ rule }) => rule)
    ).toEqual(["internal-package"]);
  });

  test("skillset siblings retain their inline command context", () => {
    const inlineRules = (command: string): readonly string[] =>
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "Run `" + command + "`."
      ).map(({ rule }) => rule);
    for (const command of [
      "skillset check; rg packages/core public",
      "rg packages/core public; skillset check",
      "skillset check; fd docs/development public",
    ]) expect(inlineRules(command)).toEqual([]);
    expect(inlineRules("skillset check; rg TODO packages/core")).toEqual([
      "internal-package",
    ]);
    expect(inlineRules("skillset check; cat packages/core")).toEqual([
      "internal-package",
    ]);
  });

  test("preserves path-valued leading assignments outside exempt arguments", () => {
    for (const executable of ["tool", "skillset", "rg"]) {
      for (const command of [
        `OUT=docs/development/out ${executable} check`,
        `env -C docs OUT=development/out ${executable} check`,
        `sudo -D docs OUT=development/out ${executable} check`,
      ]) {
        for (const text of [`\`\`\`sh\n${command}\n\`\`\``, `Run \`${command}\`.`]) {
          expect(
            scanGeneratedPublicContent(
              "plugins/skillset/codex/skills/skillset/SKILL.md",
              text
            ).map(({ rule }) => rule)
          ).toEqual(["development-docs"]);
        }
      }
    }
    for (const command of [
      "OUT=scripts/private.ts skillset check",
      "env -C scripts OUT=./private.ts skillset check",
      "OUT=scripts/private.ts rg TODO public",
    ]) expect(rules(command)).toEqual(["internal-script"]);
    for (const command of [
      "OUT=scripts/public.ts skillset check",
      "env -C public OUT=./private.ts skillset check",
      "LABEL=packages skillset check",
      "env LABEL=packages rg TODO public",
      "OUT=public/out skillset explain packages/core",
      "skillset check OUT=packages/core",
      "env -C docs OUT=/usr/local/out skillset check",
      "sudo -u OUT=packages/core skillset check",
    ]) expect(rules(command)).toEqual([]);
  });

  test("preserves redirection routes around exempt skillset arguments", () => {
    for (const command of [
      "skillset check > packages/core/out.txt",
      "> packages/core/out.txt skillset explain public",
      'skillset check >> "packages/core/out.txt"',
      "skillset check < packages/core/input.txt",
      "skillset check 2>packages/core/error.txt",
      "skillset check &>packages/core/output.txt",
      "skillset check >|packages/core/output.txt",
      "env -C public skillset check > packages/core/out.txt",
      "skillset check > public/out.txt; cat < packages/core/input.txt",
    ]) {
      for (const text of [`\`\`\`sh\n${command}\n\`\`\``, `Run \`${command}\`.`]) {
        expect(
          scanGeneratedPublicContent(
            "plugins/skillset/codex/skills/skillset/SKILL.md",
            text
          ).map(({ rule }) => rule)
        ).toEqual(["internal-package"]);
      }
    }
    expect(rules("skillset check > scripts")).toEqual(["internal-script"]);
    expect(rules("skillset check > fixtures")).toEqual(["fixture-path"]);
    for (const command of [
      "skillset explain packages/core > public/out.txt",
      "> public/out.txt skillset explain packages/core",
      "skillset explain packages/core 2>&1",
      "skillset explain packages/core <&packages/core",
      "skillset explain packages/core 2>&packages/core",
      "skillset explain packages/core << packages",
      "skillset explain packages/core <<< packages/core",
      "env -C docs skillset explain packages/core > development/out.txt",
      'skillset explain "packages/core > fixtures" > public/out.txt',
    ]) expect(rules(command)).toEqual([]);
  });

  test("checks executable paths before command-specific operand handling", () => {
    for (const executable of ["tool", "rg", "echo", "printf", "git", "skillset"]) {
      for (const text of [
        `\`\`\`sh\nenv -C docs development/${executable} --help\n\`\`\``,
        `Run \`env -C docs development/${executable} --help\`.`,
      ]) {
        expect(
          scanGeneratedPublicContent(
            "plugins/skillset/codex/skills/skillset/SKILL.md",
            text
          ).map(({ rule }) => rule)
        ).toEqual(["development-docs"]);
      }
    }
    expect(rules("env -C docs development --help")).toEqual([]);
    expect(rules("env -C docs /usr/local/bin/tool --help")).toEqual([]);
    expect(rules("env -C docs ../public/tool --help")).toEqual([]);
    expect(rules("./development/git -C docs --help")).toEqual([]);
  });

  test("only bare skillset commands exempt protected executable routes", () => {
    for (const [command, rule] of [
      ["packages/core/skillset check", "internal-package"],
      ["../packages/core/skillset check", "internal-package"],
      ["/repo/packages/core/skillset check", "internal-package"],
      ["sudo packages/core/skillset check", "internal-package"],
      ["env -C docs development/skillset check", "development-docs"],
      ["scripts/skillset check", "internal-script"],
    ] as const) {
      for (const text of [
        "```sh\n" + command + "\n```",
        "Run `" + command + "`.",
      ]) {
        expect(
          scanGeneratedPublicContent(
            "plugins/skillset/codex/skills/skillset/SKILL.md",
            text,
            ["scripts/skillset"],
            new Set(),
            undefined,
            "/repo"
          ).map(({ rule }) => rule)
        ).toEqual([rule]);
      }
    }
    expect(rules("skillset explain packages/core")).toEqual([]);
    expect(rules("/usr/local/bin/skillset check")).toEqual([]);
    expect(rules("./skillset check")).toEqual([]);
    expect(rules("scripts/skillset check")).toEqual([]);
  });

  test("cwd semantics supplement scanning without inventing joins", () => {
    for (const command of [
      "env -C docs rg TODO development",
      "env -C docs rg --pre 'cat development' TODO public",
      "env -C docs fd TODO development",
      "git -C docs -C development status",
      "git -C docs --work-tree=development status",
      "env -C docs git -C development status",
      "env -C docs env -C development pwd",
    ])
      expect(rules(command)).toEqual(["development-docs"]);
    for (const command of [
      "env -C docs -C development pwd",
      "time -o docs env -C development pwd",
      "unknown-tool docs development",
      "git -C public --git-dir=scripts/.git log",
    ])
      expect(rules(command)).toEqual([]);
    expect(rules("git -C scripts/subdir status")).toEqual(["internal-script"]);
    expect(rules("git --git-dir=scripts/.git status")).toEqual([
      "internal-script",
    ]);
    expect(rules("git --git-dir=scripts/.git -C public status")).toEqual([
      "internal-script",
    ]);
    expect(rules("git --work-tree=development -C docs status")).toEqual([
      "development-docs",
    ]);
    expect(rules("sudo --chroot=scripts/subdir command")).toEqual([
      "internal-script",
    ]);
    expect(rules("sudo -R scripts/subdir command")).toEqual([
      "internal-script",
    ]);
  });

  test("percent-decoding remains an explicit one-off, outside the eight structural fixes", () => {
    expect(
      scanGeneratedPublicContent(
        "plugins/skillset/codex/skills/skillset/SKILL.md",
        "[source](../../../pack%61ges/core/src/index.ts)"
      ).map(({ rule }) => rule)
    ).toEqual(["internal-package"]);
  });
});
