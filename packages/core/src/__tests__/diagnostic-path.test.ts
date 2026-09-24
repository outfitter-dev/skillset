import { describe, expect, it } from "bun:test";
import path from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { inspectSkillset } from "../lint";
import {
  SkillsetFeatureDiagnosticError,
  skillsetDiagnostic,
} from "../operation-result";
import { toLogicalDiagnosticPath } from "../path";
import { renderBuildGraph } from "../render";
import { loadBuildGraph } from "../resolver";

describe("logical diagnostic path normalization", () => {
  it("converts literal Windows separators and leaves POSIX and selectors unchanged", () => {
    expect(toLogicalDiagnosticPath(".skillset\\plugins\\alpha\\hooks.json", "\\")).toBe(
      ".skillset/plugins/alpha/hooks.json"
    );
    expect(toLogicalDiagnosticPath(".skillset/plugins/alpha/hooks.json")).toBe(
      ".skillset/plugins/alpha/hooks.json"
    );
    expect(toLogicalDiagnosticPath("plugin.json#/name")).toBe("plugin.json#/name");
    expect(toLogicalDiagnosticPath("#/compile/targets/0")).toBe("#/compile/targets/0");
    expect(toLogicalDiagnosticPath("/compile/targets")).toBe("/compile/targets");
  });

  it("normalizes path.win32.relative results on every host", () => {
    const relativePath = path.win32.relative(
      "C:\\repo",
      "C:\\repo\\.skillset\\plugins\\alpha\\hooks.json"
    );
    expect(relativePath).toBe(".skillset\\plugins\\alpha\\hooks.json");
    expect(toLogicalDiagnosticPath(relativePath, "\\")).toBe(
      ".skillset/plugins/alpha/hooks.json"
    );
    expect(
      toLogicalDiagnosticPath(
        path.win32.relative(
          "C:\\repo",
          path.win32.join("C:\\repo", ".skillset", "plugins", "alpha", "SKILL.md")
        ),
        "\\"
      )
    ).toBe(".skillset/plugins/alpha/SKILL.md");
  });

  it("rewrites matching path fragments in feature diagnostic messages", () => {
    const native = path.join(".skillset", "plugins", "alpha", "hooks.json");
    const error = new SkillsetFeatureDiagnosticError({
      code: "plugin-root-hooks-unsupported",
      featureId: "plugin-hooks",
      message: `skillset: plugin alpha uses unsupported root hooks.json at ${native}`,
      path: native,
    });
    expect(error.path).toBe(".skillset/plugins/alpha/hooks.json");
    expect(error.message).toContain(".skillset/plugins/alpha/hooks.json");
    expect(error.message).not.toContain("\\");
  });

  it("normalizes SkillsetDiagnostic path and outputPath fields", () => {
    const diagnostic = skillsetDiagnostic({
      code: "generated-output-missing",
      message: `missing generated file: ${path.join("plugins", "demo", "skills", "review", "SKILL.md")}`,
      outputPath: path.join("plugins", "demo", "skills", "review", "SKILL.md"),
      path: path.join(".skillset", "plugins", "demo", "skills", "review", "SKILL.md"),
      severity: "error",
    });
    expect(diagnostic.path).toBe(".skillset/plugins/demo/skills/review/SKILL.md");
    expect(diagnostic.outputPath).toBe("plugins/demo/skills/review/SKILL.md");
    expect(diagnostic.message).toBe(
      "missing generated file: plugins/demo/skills/review/SKILL.md"
    );
  });

  it("resolver feature diagnostics use portable path fields and messages", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: hook-root
claude: true
codex: false
`,
      ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
      ".skillset/plugins/alpha/hooks.json": `
{
  "SessionStart": [ { "hooks": [ { "type": "command", "command": "./scripts/run.sh" } ] } ]
}
`,
      ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
    });

    try {
      await loadBuildGraph(root);
      throw new Error("expected plugin-root-hooks-unsupported");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillsetFeatureDiagnosticError);
      const diagnostic = error as SkillsetFeatureDiagnosticError;
      expect(diagnostic.code).toBe("plugin-root-hooks-unsupported");
      expect(diagnostic.path).toBe(".skillset/plugins/alpha/hooks.json");
      expect(diagnostic.path).not.toInclude("\\");
      expect(diagnostic.message).not.toInclude("\\");
    }
  });

  it("renderer feature diagnostics use portable path fields and messages", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: flatten-root
claude: true
codex: false
`,
      ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
      ".skillset/plugins/alpha/skills/demo/SKILL.md": `
---
name: review
description: First demo.
---

Body.
`,
      ".skillset/plugins/alpha/skills/other/SKILL.md": `
---
name: review
description: Nested demo.
---

Body.
`,
    });

    const graph = await loadBuildGraph(root);
    try {
      await renderBuildGraph(graph);
      throw new Error("expected plugin-skill-flattening-conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillsetFeatureDiagnosticError);
      const diagnostic = error as SkillsetFeatureDiagnosticError;
      expect(diagnostic.code).toBe("plugin-skill-flattening-conflict");
      expect(diagnostic.path).toBe(".skillset/plugins/alpha/skills/other/SKILL.md");
      expect(diagnostic.path).not.toInclude("\\");
      expect(diagnostic.message).toContain(
        ".skillset/plugins/alpha/skills/demo/SKILL.md"
      );
      expect(diagnostic.message).toContain(
        ".skillset/plugins/alpha/skills/other/SKILL.md"
      );
      expect(diagnostic.message).not.toInclude("\\");
    }
  });

  it("lint issues use portable path fields and matching message fragments", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: lint-root
claude: true
codex: false
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: other
description: Demo.
---

Body.
`,
    });

    const result = await inspectSkillset(await loadBuildGraph(root));
    const issue = result.issues.find((entry) => entry.code === "skill-name-directory-mismatch");
    expect(issue).toMatchObject({
      code: "skill-name-directory-mismatch",
      path: ".skillset/skills/demo/SKILL.md",
    });
    expect(issue?.path).not.toInclude("\\");
    expect(issue?.message).not.toInclude("\\");
  });

  it("preserves a literal backslash in a POSIX source filename", async () => {
    if (path.sep !== "/") return;
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: literal-backslash
claude: true
codex: false
`,
      ".skillset/skills/demo\\child/SKILL.md": `
---
name: other
description: Demo.
---

Body.
`,
    });

    const result = await inspectSkillset(await loadBuildGraph(root));
    const issue = result.issues.find((entry) => entry.code === "skill-name-directory-mismatch");
    expect(issue?.path).toBe(".skillset/skills/demo\\child/SKILL.md");
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await createTestFixtureRoot("skillset-diagnostic-path-");
  for (const [filePath, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(path.join(root, filePath), `${content.trim()}\n`);
  }
  return root;
}
