import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";
import { renderedSkillPaths } from "../rendered-skill-paths";
import { targetNames } from "../targets";
import {
  evaluateSkillsetTestRuntime,
  evaluateSkillsetTestWorkspace,
  loadSkillsetTestDeclaration,
} from "../test-evaluation";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function fixture(files: Record<string, string>) {
  const root = await createTestFixtureRoot("evaluation-skill-identity-");
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}
const source =
  "---\nname: demo\ndescription: Demo skill.\n---\n\nIdentity body.\n";
const declaration = `demo:
  checks:
    projection: true
  activation:
    - name: static demo
      prompt: Inspect demo.
      expect:
        skill: demo
    - name: runtime demo
      prompt: Execute demo.
      expect:
        skill: demo
      runtime:
        expect:
          contains: accepted
`;

for (const owner of ["standalone", "plugin"] as const) {
  for (const directory of [
    "demo",
    "(group)/demo",
    "(group)/different-folder",
  ]) {
    test(`${owner} ${directory} uses emitted identity for static and fake runtime activation`, async () => {
      const sourceRoot =
        owner === "standalone" ? ".skillset" : ".skillset/plugins/acme";
      const root = await fixture({
        "skillset.yaml": "skillset:\n  name: identity-test\n",
        [`${sourceRoot}/skills/${directory}/SKILL.md`]: source,
        ...(owner === "plugin"
          ? {
              ".skillset/plugins/acme/skillset.yaml":
                "skillset:\n  name: acme\n",
            }
          : {}),
        ".skillset/tests.yaml": declaration,
      });
      const { graph, declaration: parsed } = await loadSkillsetTestDeclaration(
        root,
        "demo"
      );
      const evaluation = await evaluateSkillsetTestWorkspace(
        root,
        graph,
        parsed,
        {}
      );
      expect(evaluation.ok).toBe(true);
      const calls: string[] = [];
      const runtime = await evaluateSkillsetTestRuntime(
        root,
        parsed,
        {},
        {
          run: async (request) => {
            calls.push(request.target);
            return { command: ["fake"], response: "accepted", state: "passed" };
          },
        },
        evaluation
      );
      expect(calls).toEqual([...targetNames()]);
      expect(runtime.every((result) => result.ok)).toBe(true);
      const output =
        owner === "standalone"
          ? ".agents/skills/demo/SKILL.md"
          : "plugins/acme/skills/demo/SKILL.md";
      expect(await readFile(join(root, output), "utf8")).toContain(
        "Identity body."
      );
    });
  }
}

const claudeDeclaration = declaration.replaceAll(
  "\n      expect:",
  "\n      targets: [claude]\n      expect:"
);
for (const disabled of [false, true]) {
  test(`shared plugin output does not qualify ${disabled ? "disabled" : "filtered"} target`, async () => {
    const root = await fixture({
      "skillset.yaml": "skillset:\n  name: target-identity\n",
      ".skillset/plugins/acme/skillset.yaml": `skillset:\n  name: acme\n${disabled ? "claude: false\n" : ""}`,
      ".skillset/plugins/acme/skills/(group)/folder/SKILL.md": source,
      ".skillset/tests.yaml": claudeDeclaration,
    });
    const { graph, declaration: parsed } = await loadSkillsetTestDeclaration(
      root,
      "demo"
    );
    const options = disabled ? {} : { targetFilter: ["codex" as const] };
    const build = await buildSkillsetResult(root, options);
    expect(build.ok).toBe(true);
    expect(
      await Bun.file(join(root, "plugins/acme/skills/demo/SKILL.md")).exists()
    ).toBe(true);
    let calls = 0;
    const runtime = await evaluateSkillsetTestRuntime(
      root,
      parsed,
      {},
      {
        run: async () => {
          calls++;
          return { command: ["fake"], state: "passed" };
        },
      },
      { rendered: build.data, renderResults: build.renderResults }
    );
    expect(calls).toBe(0);
    expect(runtime[0]).toMatchObject({ failureClass: "render", ok: false });
    await expect(
      evaluateSkillsetTestWorkspace(root, graph, parsed, options)
    ).rejects.toThrow("was not emitted for target claude");
  });
}

test("missing emitted skill cannot be replaced by an unmanaged old-layout file", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: missing-output\n",
    ".skillset/skills/(group)/folder/SKILL.md": source,
    ".skillset/skills/(group)/folder/references/SKILL.md": "Resource only.\n",
    ".skillset/tests.yaml": claudeDeclaration,
  });
  const { graph, declaration: parsed } = await loadSkillsetTestDeclaration(
    root,
    "demo"
  );
  const evaluation = await evaluateSkillsetTestWorkspace(
    root,
    graph,
    parsed,
    {}
  );
  expect(
    await Bun.file(
      join(root, ".claude/skills/demo/references/SKILL.md")
    ).exists()
  ).toBe(true);
  await rm(join(root, ".claude/skills/demo/SKILL.md"));
  await mkdir(join(root, ".claude/skills/(group)/folder"), { recursive: true });
  await writeFile(join(root, ".claude/skills/(group)/folder/SKILL.md"), source);
  let calls = 0;
  const runtime = await evaluateSkillsetTestRuntime(
    root,
    parsed,
    {},
    {
      run: async () => {
        calls++;
        return { command: ["fake"], state: "passed" };
      },
    },
    evaluation
  );
  expect(calls).toBe(0);
  expect(runtime[0]).toMatchObject({ failureClass: "render", ok: false });
});

test("project-use collision allocation is queried by source ownership", async () => {
  const root = await fixture({
    "skillset.yaml":
      "skillset:\n  name: copies\ncompile:\n  targets: [claude]\nplugins:\n  internal_use:\n    skills:\n      acme: true\n",
    ".skillset/skills/demo/SKILL.md": source,
    ".skillset/plugins/acme/skillset.yaml": "skillset:\n  name: acme\n",
    ".skillset/plugins/acme/skills/(group)/folder/SKILL.md": source,
    ".skillset/tests.yaml": claudeDeclaration,
  });
  const { graph, declaration: parsed } = await loadSkillsetTestDeclaration(
    root,
    "demo"
  );
  const evaluation = await evaluateSkillsetTestWorkspace(root, graph, parsed, {
    scopes: ["repo"],
  });
  expect(evaluation.ok).toBe(true);
  expect(
    renderedSkillPaths(evaluation, "claude", [
      {
        sourceUnit: "plugin.acme.skill:demo",
        sourcePath: ".skillset/plugins/acme/skills/(group)/folder/SKILL.md",
      },
    ])
  ).toEqual([".claude/skills/acme-demo/SKILL.md"]);
  await rm(join(root, ".claude/skills/demo/SKILL.md"));
  let calls = 0;
  const runtime = await evaluateSkillsetTestRuntime(
    root,
    parsed,
    {},
    {
      run: async () => {
        calls++;
        return { command: ["fake"], response: "accepted", state: "passed" };
      },
    },
    evaluation
  );
  expect(calls).toBe(1);
  expect(runtime[0]?.ok).toBe(true);
});
