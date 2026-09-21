import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildSkillsetResult } from "@skillset/core";
import {
  doctorSkillset,
  explainPath,
} from "@skillset/core/internal/authoring";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

const roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-project-use-"));
  roots.push(root);
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return root;
}

const skill = (name: string, body: string) =>
  `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("SET-554 project-use skill copies", () => {
  it("resolves collisions once, marks copies, records provenance, and cleans up deselection", async () => {
    const config = (selection: string) => `
skillset:
  name: project-use
compile:
  unsupportedDestination: warn
claude: true
codex: true
cursor: true
internal_marker: true
plugins:
  internal_use:
    skills:
      alpha: ${selection}
      beta: true
`;
    const root = await fixture({
      "skillset.yaml": config("true"),
      ".skillset/skills/shared/SKILL.md": skill("shared", "Workspace copy"),
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha\n",
      ".skillset/plugins/alpha/skills/(group)/shared/SKILL.md": skill(
        "shared",
        "Alpha copy"
      ),
      ".skillset/plugins/alpha/bin/tool": "#!/bin/sh\nexit 0\n",
      ".skillset/plugins/beta/skillset.yaml": "skillset:\n  name: beta\n",
      ".skillset/plugins/beta/skills/shared/SKILL.md": skill(
        "shared",
        "Beta copy"
      ),
    });
    const result = await buildSkillsetResult(root);
    for (const targetRoot of [
      ".claude/skills",
      ".agents/skills",
      ".cursor/skills",
    ]) {
      expect(
        await Bun.file(join(root, targetRoot, "shared/SKILL.md")).exists()
      ).toBe(true);
      expect(
        await Bun.file(join(root, targetRoot, "alpha-shared/SKILL.md")).exists()
      ).toBe(true);
      expect(
        await Bun.file(join(root, targetRoot, "beta-shared/SKILL.md")).exists()
      ).toBe(true);
      expect(
        await readFile(join(root, targetRoot, "alpha-shared/SKILL.md"), "utf8")
      ).toContain("internal: true");
    }
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({ code: "internal-use-name-conflict" }),
        ],
        sourceUnit: "plugin.alpha.skill:shared",
        target: "codex",
      })
    );
    expect(result.renderResults).not.toContainEqual(
      expect.objectContaining({
        destination: "bin",
        featureId: "internal-use-components",
        sourceUnit: "plugin.alpha.skill:shared",
        target: "codex",
      })
    );
    expect(
      await explainPath(root, ".agents/skills/alpha-shared/SKILL.md")
    ).toMatchObject({
      entries: [
        expect.objectContaining({
          effectiveName: "alpha-shared",
          owner: { target: "codex" },
          role: "project-use",
          selectionRule: "plugins.internal_use.skills.alpha: true",
          sourceUnit: "plugin.alpha.skill:shared",
        }),
      ],
    });
    expect((await doctorSkillset(root)).projectUse).toEqual(
      expect.arrayContaining([
        {
          effectiveName: "alpha-shared",
          owner: { target: "codex" },
          role: "project-use",
          selectionRule: "plugins.internal_use.skills.alpha: true",
          sourcePath:
            ".skillset/plugins/alpha/skills/(group)/shared/SKILL.md",
          sourceUnit: "plugin.alpha.skill:shared",
          target: "codex",
        },
      ])
    );

    await mkdir(join(root, ".agents/skills/unmanaged"), { recursive: true });
    await writeFile(join(root, ".agents/skills/unmanaged/NOTE.md"), "keep\n");
    await writeFile(join(root, "skillset.yaml"), config("false"));
    await buildSkillsetResult(root);
    expect(
      await Bun.file(
        join(root, ".agents/skills/alpha-shared/SKILL.md")
      ).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".agents/skills/unmanaged/NOTE.md")).exists()
    ).toBe(true);
    expect(
      await Bun.file(join(root, ".agents/skills/beta-shared/SKILL.md")).exists()
    ).toBe(true);
    expect(
      await Bun.file(join(root, ".agents/skills/shared/SKILL.md")).exists()
    ).toBe(true);
  });

  it("omits the internal marker when internal_marker is false", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: marker-off\nclaude: false\ncodex: true\ncursor: false\ninternal_marker: false\nplugins:\n  internal_use:\n    skills:\n      demo: true\n`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": `---
name: use-me
description: Use me
codex:
  frontmatter:
    metadata:
      internal: true
---

Use me.
`,
    });
    await buildSkillsetResult(root);
    const markdown = await readFile(
      join(root, ".agents/skills/use-me/SKILL.md"),
      "utf8"
    );
    expect(markdown).not.toContain("internal:");
  });

  it("keeps the project-use marker when Codex frontmatter tries to override it", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: marker-override\nclaude: false\ncodex: true\ncursor: false\nplugins:\n  internal_use:\n    skills:\n      demo: true\n`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": `---
name: use-me
description: Use me
codex:
  frontmatter:
    metadata:
      internal: false
      owner: demo
---

Use me.
`,
    });
    await buildSkillsetResult(root);
    const projectCopy = await readFile(
      join(root, ".agents/skills/use-me/SKILL.md"),
      "utf8"
    );
    expect(projectCopy).toContain("internal: true");
    expect(projectCopy).toContain("owner: demo");
    const packageSkill = await readFile(
      join(root, "plugins/demo/skills/use-me/SKILL.md"),
      "utf8"
    );
    expect(packageSkill).not.toContain("internal: true");
  });

  it("allocates final names globally across workspace and plugin prefix collisions", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:
  name: global-project-use-names
claude: false
codex: true
cursor: false
plugins:
  internal_use:
    skills:
      alpha: true
      beta: true
      delta: true
      epsilon: true
      gamma: true
`,
      ".skillset/skills/shared/SKILL.md": skill("shared", "Workspace shared"),
      ".skillset/skills/alpha-shared/SKILL.md": skill(
        "alpha-shared",
        "Workspace prefixed"
      ),
      ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha\n",
      ".skillset/plugins/alpha/skills/shared/SKILL.md": skill(
        "shared",
        "Alpha shared"
      ),
      ".skillset/plugins/beta/skillset.yaml": "skillset:\n  name: beta\n",
      ".skillset/plugins/beta/skills/shared/SKILL.md": skill(
        "shared",
        "Beta shared"
      ),
      ".skillset/plugins/delta/skillset.yaml": "skillset:\n  name: delta\n",
      ".skillset/plugins/delta/skills/common/SKILL.md": skill(
        "common",
        "Delta common"
      ),
      ".skillset/plugins/epsilon/skillset.yaml": "skillset:\n  name: epsilon\n",
      ".skillset/plugins/epsilon/skills/common/SKILL.md": skill(
        "common",
        "Epsilon common"
      ),
      ".skillset/plugins/gamma/skillset.yaml": "skillset:\n  name: gamma\n",
      ".skillset/plugins/gamma/skills/delta-common/SKILL.md": skill(
        "delta-common",
        "Gamma prefixed"
      ),
    });

    const result = await buildSkillsetResult(root);
    for (const name of [
      "shared",
      "alpha-shared",
      "alpha-alpha-shared",
      "beta-shared",
      "delta-delta-common",
      "epsilon-common",
      "gamma-delta-common",
    ]) {
      expect(
        await Bun.file(join(root, `.agents/skills/${name}/SKILL.md`)).exists()
      ).toBe(true);
    }
    const alphaDiagnostic = result.renderResults.find(
      (outcome) =>
        outcome.sourceUnit === "plugin.alpha.skill:shared" &&
        outcome.target === "codex" &&
        outcome.diagnostics?.some(
          (diagnostic) => diagnostic.code === "internal-use-name-conflict"
        )
    );
    const message = alphaDiagnostic?.diagnostics?.find(
      (diagnostic) => diagnostic.code === "internal-use-name-conflict"
    )?.message ?? "";
    for (const source of [
      "workspace:shared",
      "workspace:alpha-shared",
      "plugin.alpha.skill:shared",
      "plugin.beta.skill:shared",
    ]) {
      expect(message).toContain(source);
    }
    expect(message).toContain("emitted as alpha-alpha-shared");

    const deltaMessage = result.renderResults.find(
      (outcome) =>
        outcome.sourceUnit === "plugin.delta.skill:common" &&
        outcome.target === "codex" &&
        outcome.diagnostics?.some(
          (diagnostic) => diagnostic.code === "internal-use-name-conflict"
        )
    )?.diagnostics?.find(
      (diagnostic) => diagnostic.code === "internal-use-name-conflict"
    )?.message ?? "";
    for (const source of [
      "plugin.delta.skill:common",
      "plugin.epsilon.skill:common",
      "plugin.gamma.skill:delta-common",
    ]) {
      expect(deltaMessage).toContain(source);
    }
    expect(deltaMessage).toContain("emitted as delta-delta-common");
  });

  it("keeps Agent Skills partial dependencies in Codex project-use provenance", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:
  name: project-use-partials
compile:
  unsupportedDestination: warn
claude: false
codex: true
cursor: false
plugins:
  internal_use:
    skills:
      demo: true
`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": skill(
        "use-me",
        "Use {{> plugin:note}}"
      ),
      ".skillset/plugins/demo/shared/partials/note.md": "first note\n",
    });

    await buildSkillsetResult(root);
    const firstLock = await projectUseLock(root);
    expect(firstLock.preprocessDependencies).toEqual([
      ".skillset/plugins/demo/shared/partials/note.md",
    ]);
    expect(
      await readFile(join(root, ".agents/skills/use-me/SKILL.md"), "utf8")
    ).toContain("first note");

    await writeFile(
      join(root, ".skillset/plugins/demo/shared/partials/note.md"),
      "second note\n"
    );
    await buildSkillsetResult(root);
    const secondLock = await projectUseLock(root);
    expect(secondLock.preprocessDependencies).toEqual(
      firstLock.preprocessDependencies
    );
    expect(secondLock.outputHash).not.toBe(firstLock.outputHash);
    expect(secondLock.sourceHash).not.toBe(firstLock.sourceHash);
    expect(
      await readFile(join(root, ".agents/skills/use-me/SKILL.md"), "utf8")
    ).toContain("second note");
  });

  it("copies implicit Agent Skills resources referenced by a project-use skill", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: linked-project-use\ncompile:\n  unsupportedDestination: warn\nclaude: false\ncodex: true\ncursor: false\nplugins:\n  internal_use:\n    skills:\n      demo: true\n`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": skill(
        "use-me",
        "Read @{{plugin:references/guide.md}}."
      ),
      ".skillset/plugins/demo/shared/references/guide.md": "Guide content.\n",
    });
    await buildSkillsetResult(root);
    const markdown = await readFile(
      join(root, ".agents/skills/use-me/SKILL.md"),
      "utf8"
    );
    expect(markdown).toContain("@references/guide.md");
    expect(await readFile(
      join(root, ".agents/skills/use-me/references/guide.md"),
      "utf8"
    )).toBe("Guide content.\n");
  });

  it("ignores unrelated shared files when only a skill is selected", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: independent-copy\nclaude: false\ncodex: true\ncursor: false\nplugins:\n  internal_use:\n    skills:\n      demo: true\n`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": skill("use-me", "Independent"),
      ".skillset/plugins/demo/shared/partials/unused.md": "Unrelated.\n",
    });
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    expect(await Bun.file(join(root, ".agents/skills/use-me/SKILL.md")).exists()).toBe(true);
    expect(result.renderResults).not.toContainEqual(
      expect.objectContaining({
        destination: "shared",
        featureId: "internal-use-components",
        sourceUnit: "plugin.demo.skill:use-me",
      })
    );
  });

  it("reports unhydrated components when the whole plugin is selected", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: whole-plugin-copy\ncompile:\n  unsupportedDestination: warn\nclaude: false\ncodex: true\ncursor: false\nplugins:\n  internal_use:\n    plugins: [demo]\n`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": skill("use-me", "Use me"),
      ".skillset/plugins/demo/shared/partials/note.md": "Shared.\n",
    });
    const result = await buildSkillsetResult(root);
    expect(await Bun.file(join(root, ".agents/skills/use-me/SKILL.md")).exists()).toBe(true);
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        destination: "shared",
        featureId: "internal-use-components",
        sourceUnit: "plugin.demo.skill:use-me",
        status: "unsupported",
        target: "codex",
      })
    );
  });

  it("reports a selected skill's own hook when its project copy omits it", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: skill-hook-copy\ncompile:\n  unsupportedDestination: warn\nclaude: true\ncodex: false\ncursor: false\nplugins:\n  internal_use:\n    skills:\n      demo: true\n`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": `---
name: use-me
description: Use me
hooks:
  PreToolUse:
    - local-shell
---

Use me.
`,
      ".skillset/plugins/demo/skills/use-me/hooks/local-shell.json": JSON.stringify({
        events: ["PreToolUse"],
        run: { command: "node ./local.js" },
      }),
    });
    const result = await buildSkillsetResult(root);
    expect(await Bun.file(join(root, ".claude/skills/use-me/SKILL.md")).exists()).toBe(true);
    expect(await Bun.file(join(root, ".claude/skills/use-me/hooks/local-shell.json")).exists()).toBe(false);
    const lock = JSON.parse(await readFile(join(root, ".claude/skills/skillset.lock"), "utf8")) as {
      readonly items: readonly { readonly files?: readonly string[]; readonly role?: string }[];
    };
    expect(lock.items.find((item) => item.role === "project-use")?.files).not.toContain(
      ".claude/skills/use-me/hooks/local-shell.json"
    );
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        destination: "hooks",
        featureId: "internal-use-components",
        sourceUnit: "plugin.demo.skill:use-me",
        status: "unsupported",
        target: "claude",
      })
    );
  });

  it("does not report a skill hook excluded from the target by its definition", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: filtered-skill-hook\nclaude: false\ncodex: true\ncursor: false\nplugins:\n  internal_use:\n    skills:\n      demo: true\n`,
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/use-me/SKILL.md": `---
name: use-me
description: Use me
hooks:
  PreToolUse:
    - local-shell
---

Use me.
`,
      ".skillset/plugins/demo/skills/use-me/hooks/local-shell.json": JSON.stringify({
        events: ["PreToolUse"],
        providers: ["claude"],
        run: { command: "node ./local.js" },
      }),
    });
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    expect(result.renderResults).not.toContainEqual(
      expect.objectContaining({
        destination: "hooks",
        featureId: "internal-use-components",
        sourceUnit: "plugin.demo.skill:use-me",
        target: "codex",
      })
    );
  });

  it("reports a whole plugin's hook attached from the workspace hook source", async () => {
    const root = await fixture({
      "skillset.yaml": `skillset:\n  name: root-hook-copy\ncompile:\n  unsupportedDestination: warn\nclaude: true\ncodex: false\ncursor: false\nplugins:\n  internal_use:\n    plugins: [demo]\n`,
      ".skillset/plugins/demo/skillset.yaml": `skillset:
  name: demo
hooks:
  SessionStart:
    - hello
`,
      ".skillset/plugins/demo/skills/use-me/SKILL.md": skill("use-me", "Use me"),
      ".skillset/hooks/hello.json": JSON.stringify({
        events: ["SessionStart"],
        run: { command: "node ./hello.js" },
      }),
    });
    const result = await buildSkillsetResult(root);
    expect(await Bun.file(join(root, ".claude/skills/use-me/SKILL.md")).exists()).toBe(true);
    expect(result.renderResults).toContainEqual(
      expect.objectContaining({
        destination: "hooks",
        featureId: "internal-use-components",
        sourceUnit: "plugin.demo.skill:use-me",
        status: "unsupported",
        target: "claude",
      })
    );
  });
});

async function projectUseLock(root: string): Promise<{
  readonly outputHash: string;
  readonly preprocessDependencies?: readonly string[];
  readonly sourceHash: string;
}> {
  const lock = JSON.parse(
    await readFile(join(root, ".agents/skills/skillset.lock"), "utf8")
  ) as {
    readonly items: readonly {
      readonly outputHash?: string;
      readonly preprocessDependencies?: readonly string[];
      readonly role?: string;
      readonly sourceHash?: string;
    }[];
  };
  const item = lock.items.find((candidate) => candidate.role === "project-use");
  if (item?.outputHash === undefined || item.sourceHash === undefined) {
    throw new Error("expected project-use lock item with source and output hashes");
  }
  return {
    outputHash: item.outputHash,
    ...(item.preprocessDependencies === undefined
      ? {}
      : { preprocessDependencies: item.preprocessDependencies }),
    sourceHash: item.sourceHash,
  };
}
