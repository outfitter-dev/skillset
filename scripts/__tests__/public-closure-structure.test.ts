import { describe, expect, test } from "bun:test";

import { scanGeneratedPublicContent } from "../public-closure-guard";
import { normalizeClosureText } from "../public-closure/closure-text";
import { shellOperandCandidates } from "../public-closure/shell-tokens";

const publicFile = "plugins/skillset/codex/skills/skillset/SKILL.md";

function rules(text: string): readonly string[] {
  return scanGeneratedPublicContent(
    publicFile,
    text,
    ["scripts/private.ts"],
    new Set(),
    undefined,
    "/repo"
  ).map(({ rule }) => rule);
}

describe("SET-489 structural path extraction", () => {
  test("SET-491: unresolved leading variables expose repository paths", () => {
    for (const prefix of [
      "$REPO_ROOT",
      "${REPO_ROOT}",
      "$ROOT/${CHECKOUT}",
      "$PWDX",
    ]) {
      expect(rules(`cat "${prefix}/packages/core/src/index.ts"`)).toEqual([
        "internal-package",
      ]);
      expect(rules(`cd "${prefix}/docs/development"`)).toEqual([
        "development-docs",
      ]);
      expect(rules(`cat "${prefix}/scripts/private.ts"`)).toEqual([
        "internal-script",
      ]);
    }
  });

  test("external homes and literal parent trees stay outside repository ownership", () => {
    for (const path of [
      "$HOME/packages/core/src/index.ts",
      "${HOME}/scripts/private.ts",
      "$HOME/skillset/packages/core/src/index.ts",
      "myrepo/$ROOT/packages/core/src/index.ts",
      "$ROOT/myrepo/packages/core/src/index.ts",
      "${CLAUDE_PLUGIN_ROOT}/scripts/check.sh",
      "$ROOT/docs/reference/skills.md",
    ]) {
      expect(rules(`cat "${path}"`)).toEqual([]);
    }
  });

  test("normalization supplies the same expansion policy to shell and prose views", () => {
    const normalized = normalizeClosureText(
      'cat "$ROOT/packages/core"',
      "/repo",
      true
    );
    expect(normalized.shellText).toBe('cat "./packages/core"');
    expect(normalized.pathText).toBe("cat ./packages/core");
  });

  test("own-repository URLs are scanned independently of route and ref spellings", () => {
    for (const route of [
      "commits",
      "compare",
      "future-view",
      "edit",
      "blame",
    ]) {
      expect(
        rules(
          `[source](https://github.com/outfitter-dev/skillset/${route}/feature/topic/packages/core)`
        )
      ).toEqual(["internal-package"]);
      expect(
        rules(
          `[source](https://github.com/another/skillset/${route}/main/packages/core)`
        )
      ).toEqual([]);
      expect(
        rules(
          `[source](https://github.com/outfitter-dev/skillset-other/${route}/main/packages/core)`
        )
      ).toEqual([]);
    }
    expect(
      rules(
        "https://github.com/outfitter-dev/skillset/issues/1?path=packages/core"
      )
    ).toEqual([]);
    expect(
      rules(
        "https://github.com/outfitter-dev/skillset/commits/main/docs/developmental"
      )
    ).toEqual([]);
  });

  test("attached values are candidates without command or flag tables", () => {
    expect(shellOperandCandidates("--new-option=packages")).toEqual([
      "--new-option=packages",
      "packages",
    ]);
    expect(shellOperandCandidates("-Cpackages")).toEqual([
      "-Cpackages",
      "packages",
    ]);
    expect(shellOperandCandidates("ROOT=packages/file=name")).toEqual([
      "ROOT=packages/file=name",
      "packages/file=name",
    ]);
    expect(shellOperandCandidates("--new-option")).toEqual(["--new-option"]);
    expect(shellOperandCandidates("packages/file=name")).toEqual([
      "packages/file=name",
      "name",
    ]);
    expect(shellOperandCandidates("packages")).toEqual(["packages"]);
  });
});
