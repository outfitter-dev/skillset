import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { classifyIndividualAgentSkillPublication } from "../agent-skill-publication";
import { loadBuildGraph } from "../resolver";

const fixtureGraph = async (files: Record<string, string>) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "skillset-agent-skill-publication-")
  );
  await Promise.all(
    Object.entries(normalizeSkillsetFixtureFiles(files)).map(
      ([filePath, content]) =>
        Bun.write(path.join(root, filePath), `${content.trim()}\n`)
    )
  );
  return loadBuildGraph(root);
};

describe("individual Agent Skill publication eligibility", () => {
  test("accepts standalone skills and plugin skills with only self-contained inputs", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.mcp.json": `
{"mcpServers":{"demo":{"command":"demo-server"}}}
`,
      ".skillset/plugins/demo/agents/reviewer.md": `
---
name: reviewer
description: Review work.
---

Review.
`,
      ".skillset/plugins/demo/commands/review.md": "Review a change.",
      ".skillset/plugins/demo/hooks/plugin-cleanup/hook.json": `
{
  "events": ["Stop"],
  "run": { "command": "echo cleanup" }
}
`,
      ".skillset/plugins/demo/shared/guide.md": "# Plugin guide",
      ".skillset/plugins/demo/skills/portable/SKILL.md": `
---
name: portable
description: A self-contained plugin skill.
resources:
  references: [plugin:guide.md]
---

Use the copied guide.
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
mcp: true
hooks:
  Stop: [plugin-cleanup]
codex: false
`,
      ".skillset/shared/root-guide.md": "# Root guide",
      ".skillset/skills/standalone/SKILL.md": `
---
name: standalone
description: A standalone skill.
resources:
  references: [shared:root-guide.md]
---

Use the guide.
`,
      "skillset.yaml": `
skillset:
  name: individual-skills
codex: false
`,
    });

    const [standalone] = graph.standaloneSkills;
    const [plugin] = graph.plugins;
    const portable = plugin?.skills[0];
    expect(standalone).toBeDefined();
    expect(plugin).toBeDefined();
    expect(portable).toBeDefined();
    if (
      standalone === undefined ||
      plugin === undefined ||
      portable === undefined
    ) {
      throw new Error("fixture source was not resolved");
    }

    expect(
      classifyIndividualAgentSkillPublication(graph, undefined, standalone)
    ).toEqual({ blockers: [], status: "eligible" });
    expect(
      classifyIndividualAgentSkillPublication(graph, plugin, portable)
    ).toEqual({ blockers: [], status: "eligible" });
  });

  test("rejects plugin dependencies including dependencies hoisted from child skills", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/skills/portable/SKILL.md": `
---
name: portable
description: A plugin skill with dependencies.
dependencies:
  plugins:
    - name: child-runtime
      range: ^2.0.0
---

Run the skill.
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
dependencies:
  plugins:
    - name: root-runtime
      range: ^1.0.0
codex: false
`,
      ".skillset/skills/dependent/SKILL.md": `
---
name: dependent
description: A standalone skill outside SET-529 publication eligibility.
dependencies:
  plugins:
    - name: standalone-runtime
      range: ^3.0.0
---

Run the skill.
`,
      "skillset.yaml": `
skillset:
  name: dependency-skills
codex: false
`,
    });

    const [plugin] = graph.plugins;
    const skill = plugin?.skills[0];
    const [standalone] = graph.standaloneSkills;
    expect(plugin).toBeDefined();
    expect(skill).toBeDefined();
    expect(standalone).toBeDefined();
    if (
      plugin === undefined ||
      skill === undefined ||
      standalone === undefined
    ) {
      throw new Error("fixture source was not resolved");
    }

    const classification = classifyIndividualAgentSkillPublication(
      graph,
      plugin,
      skill
    );
    expect(classification.status).toBe("ineligible");
    expect(classification.blockers).toHaveLength(2);
    expect(classification.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "plugin-dependency-required",
          message: expect.stringContaining("root-runtime"),
        }),
        expect.objectContaining({
          code: "plugin-dependency-required",
          message: expect.stringContaining("child-runtime"),
        }),
      ])
    );
    expect(
      classifyIndividualAgentSkillPublication(graph, undefined, standalone)
    ).toEqual({ blockers: [], status: "eligible" });
  });

  test("rejects skill-local hook definitions and attachments but ignores plugin-level hooks", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/hooks/plugin-cleanup/hook.json": `
{"events":["Stop"],"run":{"command":"echo plugin-cleanup"}}
`,
      ".skillset/plugins/demo/skills/attached/SKILL.md": `
---
name: attached
description: A skill that needs a hook.
hooks:
  Stop: [skill-cleanup]
---

Run the skill.
`,
      ".skillset/plugins/demo/skills/attached/hooks/skill-cleanup/hook.json": `
{"events":["Stop"],"run":{"command":"echo skill-cleanup"}}
`,
      ".skillset/plugins/demo/skills/defined/SKILL.md": `
---
name: defined
description: A skill with a local hook definition.
---

Run the skill.
`,
      ".skillset/plugins/demo/skills/defined/hooks/unused/hook.json": `
{"events":["Stop"],"run":{"command":"echo unused"}}
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop: [plugin-cleanup]
codex: false
`,
      "skillset.yaml": `
skillset:
  name: hook-skills
codex: false
`,
    });

    const [plugin] = graph.plugins;
    const attached = plugin?.skills.find((skill) => skill.id === "attached");
    const defined = plugin?.skills.find((skill) => skill.id === "defined");
    expect(plugin).toBeDefined();
    expect(attached).toBeDefined();
    expect(defined).toBeDefined();
    if (
      plugin === undefined ||
      attached === undefined ||
      defined === undefined
    ) {
      throw new Error("fixture source was not resolved");
    }

    const attachedClassification = classifyIndividualAgentSkillPublication(
      graph,
      plugin,
      attached
    );
    expect(attachedClassification.status).toBe("ineligible");
    expect(attachedClassification.blockers).toHaveLength(2);
    expect(attachedClassification.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "adaptive-hook-required",
          message: expect.stringContaining("skill-cleanup"),
        }),
      ])
    );
    expect(
      classifyIndividualAgentSkillPublication(graph, plugin, defined)
    ).toEqual({
      blockers: [
        expect.objectContaining({
          code: "adaptive-hook-required",
          message: expect.stringContaining("unused"),
        }),
      ],
      status: "ineligible",
    });
  });
});
