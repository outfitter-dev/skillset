import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSkillsetResult,
  diffSkillsetResult,
  SkillsetLoweringError,
  type SkillsetLoweringOutcome,
} from "@skillset/core";

const OUTCOME_FIXTURE: Record<string, string> = {
  ".skillset/config.yaml": `
skillset:
  name: outcome-root
  marketplace:
    name: outcome-market
claude: true
codex: true
`,
  ".skillset/skills/repo-skill/SKILL.md": `
---
name: repo-skill
description: Repo skill.
---

Use the repo skill.
`,
  ".skillset/instructions/root.md": `
---
description: Root instructions.
---

Keep generated output deterministic.
`,
  ".skillset/src/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
skills:
  - repo-skill
---

Review diffs carefully.
`,
  ".skillset/src/codex/rules/deny.rules": `
match = "rm -rf"
decision = "deny"
`,
  ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
  description: Alpha plugin.
dependencies:
  plugins:
    - name: external-tools
      range: ^2.1.0
      marketplace: acme
mcp: true
`,
  ".skillset/plugins/alpha/.app.json": `
{"apps":[]}
`,
  ".skillset/plugins/alpha/.lsp.json": `
{"servers":[]}
`,
  ".skillset/plugins/alpha/.mcp.json": `
{
  "mcpServers": {
    "alpha": { "command": "node" }
  }
}
`,
  ".skillset/plugins/alpha/README.md": `
# Alpha
`,
  ".skillset/plugins/alpha/assets/icon.txt": `
icon
`,
  ".skillset/plugins/alpha/commands/run.md": `
# Run
`,
  ".skillset/plugins/alpha/hooks/hooks.json": `
{
  "hooks": {
    "SessionStart": []
  }
}
`,
  ".skillset/plugins/alpha/monitors/monitors.json": `
{"monitors":[]}
`,
  ".skillset/plugins/alpha/output-styles/focused.md": `
# Focused
`,
  ".skillset/plugins/alpha/scripts/setup.sh": `
#!/usr/bin/env bash
echo setup
`,
  ".skillset/plugins/alpha/skills/plugin-skill/SKILL.md": `
---
name: plugin-skill
description: Plugin skill.
tool_intent:
  allow:
    read:
      - docs/**
---

Use the plugin skill.
`,
  ".skillset/plugins/alpha/src/index.js": `
export const alpha = true;
`,
  ".skillset/plugins/alpha/themes/dark.json": `
{"name":"dark"}
`,
  ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
  description: Beta plugin.
codex: false
`,
  ".skillset/plugins/beta/bin/tool": `
#!/usr/bin/env bash
echo beta
`,
  ".skillset/plugins/beta/agents/reviewer.md": `
# Plugin Reviewer

Review plugin output.
`,
  ".skillset/plugins/beta/skills/plugin-skill/SKILL.md": `
---
name: beta-skill
description: Beta skill.
---

Use the beta plugin skill.
`,
};

describe("build lowering outcomes", () => {
  it("reports emitted, pass-through, transformed, unsupported, and scoped outcomes", async () => {
    const root = await fixture(OUTCOME_FIXTURE);

    const preview = await diffSkillsetResult(root);
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "standalone-skills",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: ".claude/skills/repo-skill/SKILL.md" }),
        ]),
        sourceUnit: "skill:repo-skill",
        status: "emitted",
        target: "claude",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-skills",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "emitted",
        target: "codex",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "project-instructions",
        sourceUnit: "instruction:AGENTS.md",
        status: "transformed",
        target: "codex",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "project-agents",
        sourceUnit: "agent:reviewer",
        status: "transformed",
        target: "codex",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "target-native-islands",
        sourceUnit: "codex.rules:rules/deny.rules",
        status: "target_native",
        target: "codex",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-mcp",
        sourceUnit: "plugin.alpha.feature:mcp",
        status: "target_native",
        target: "claude",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-bin",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: "plugins-claude/plugins/beta/bin/tool" }),
        ]),
        sourceUnit: "plugin.beta.feature:bin",
        status: "target_native",
        target: "claude",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-hooks",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: "plugins-codex/plugins/alpha/hooks/hooks.json" }),
        ]),
        sourceUnit: "plugin.alpha.feature:hooks",
        status: "target_native",
        target: "codex",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-apps",
        sourceUnit: "plugin.alpha.feature:app",
        status: "target_native",
        target: "codex",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "dependencies",
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "emitted",
        target: "claude",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "dependencies",
        reason: expect.stringContaining("Codex"),
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "degraded",
        target: "codex",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "tool-intent",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: "plugins-claude/plugins/alpha/skills/plugin-skill/SKILL.md" }),
        ]),
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "transformed",
        target: "claude",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "tool-intent",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: "plugins-codex/plugins/alpha/skills/plugin-skill/.skillset.tools.yaml" }),
        ]),
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "metadata_only",
        target: "codex",
      })
    );
    expect(preview.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-agents",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: "plugins-claude/plugins/beta/agents/reviewer.md" }),
        ]),
        sourceUnit: "plugin.beta.feature:agents",
        status: "target_native",
        target: "claude",
      })
    );
    const companionExpectations = [
      {
        featureId: "plugin-readme",
        path: "plugins-claude/plugins/alpha/README.md",
        sourceUnit: "plugin.alpha.feature:readme",
        target: "claude",
      },
      {
        featureId: "plugin-assets",
        path: "plugins-codex/plugins/alpha/assets/icon.txt",
        sourceUnit: "plugin.alpha.feature:assets",
        target: "codex",
      },
      {
        featureId: "plugin-scripts",
        path: "plugins-codex/plugins/alpha/scripts/setup.sh",
        sourceUnit: "plugin.alpha.feature:scripts",
        target: "codex",
      },
      {
        featureId: "plugin-src",
        path: "plugins-codex/plugins/alpha/src/index.js",
        sourceUnit: "plugin.alpha.feature:src",
        target: "codex",
      },
      {
        featureId: "plugin-commands",
        path: "plugins-claude/plugins/alpha/commands/run.md",
        sourceUnit: "plugin.alpha.feature:commands",
        target: "claude",
      },
      {
        featureId: "plugin-lsp-servers",
        path: "plugins-claude/plugins/alpha/.lsp.json",
        sourceUnit: "plugin.alpha.feature:lsp-servers",
        target: "claude",
      },
      {
        featureId: "plugin-output-styles",
        path: "plugins-claude/plugins/alpha/output-styles/focused.md",
        sourceUnit: "plugin.alpha.feature:output-styles",
        target: "claude",
      },
      {
        featureId: "plugin-themes",
        path: "plugins-claude/plugins/alpha/themes/dark.json",
        sourceUnit: "plugin.alpha.feature:themes",
        target: "claude",
      },
      {
        featureId: "plugin-monitors",
        path: "plugins-claude/plugins/alpha/monitors/monitors.json",
        sourceUnit: "plugin.alpha.feature:monitors",
        target: "claude",
      },
    ] as const;
    for (const expected of companionExpectations) {
      expect(preview.loweringOutcomes).toContainEqual(
        expect.objectContaining({
          featureId: expected.featureId,
          outputs: expect.arrayContaining([expect.objectContaining({ path: expected.path })]),
          sourceUnit: expected.sourceUnit,
          status: "target_native",
          target: expected.target,
        })
      );
    }

    const scoped = await diffSkillsetResult(root, { scopes: ["repo"] });
    expect(scoped.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-skills",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "intentionally_skipped",
        target: "claude",
      })
    );
    expect(scoped.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "standalone-skills",
        sourceUnit: "skill:repo-skill",
        status: "emitted",
      })
    );
    expect(scoped.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-hooks",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.feature:hooks",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-apps",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.feature:app",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "dependencies",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "tool-intent",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "tool-intent",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "intentionally_skipped",
        target: "claude",
      })
    );
    expect(scoped.loweringOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-commands",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.feature:commands",
        status: "intentionally_skipped",
        target: "claude",
      })
    );

    const build = await buildSkillsetResult(root);
    expect(build.loweringOutcomes.map(outcomeKey)).toEqual(preview.loweringOutcomes.map(outcomeKey));

    const codexLock = await readJson(join(root, "plugins-codex/.skillset.lock"));
    const codexOutcomes = codexLock.loweringOutcomes as SkillsetLoweringOutcome[];
    expect(codexOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-skills",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "emitted",
        target: "codex",
      })
    );
    expect(codexOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "dependencies",
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "degraded",
        target: "codex",
      })
    );
    expect(codexOutcomes).not.toContainEqual(
      expect.objectContaining({
        target: "claude",
      })
    );

    const codexSkill = await readFile(join(root, "plugins-codex/plugins/alpha/skills/plugin-skill/SKILL.md"), "utf8");
    expect(codexSkill).not.toContain("loweringOutcomes");
    expect(JSON.stringify(codexLock)).not.toContain(root);
  });

  it("records isolated output paths relative to the isolated projection root", async () => {
    const root = await fixture(OUTCOME_FIXTURE);
    const preview = await buildSkillsetResult(root, { isolated: true });
    const outputPaths = preview.loweringOutcomes.flatMap((outcome) =>
      (outcome.outputs ?? []).map((output) => output.path)
    );

    expect(outputPaths).toContain(".skillset/build/out/.claude/skills/repo-skill/SKILL.md");
    expect(outputPaths.some((path) => path.startsWith(root))).toBe(false);

    const isolatedLock = await readJson(join(root, ".skillset/build/out/plugins-codex/.skillset.lock"));
    const isolatedOutcomes = isolatedLock.loweringOutcomes as SkillsetLoweringOutcome[];
    expect(isolatedOutcomes).toContainEqual(
      expect.objectContaining({
        outputs: expect.arrayContaining([
          expect.objectContaining({
            path: ".skillset/build/out/plugins-codex/plugins/alpha/skills/plugin-skill/SKILL.md",
          }),
        ]),
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "emitted",
        target: "codex",
      })
    );
    expect(JSON.stringify(isolatedLock)).not.toContain(root);
  });

  it("exposes resolver-level unsupported decisions on thrown lowering errors", async () => {
    const agentRoot = await fixture({
      ...OUTCOME_FIXTURE,
      ".skillset/plugins/alpha/agents/reviewer.md": `
# Plugin Reviewer

Review plugin output.
`,
    });
    await expectUnsupportedOutcome(agentRoot, {
      featureId: "plugin-agents",
      reason: "Codex plugin documentation does not include a plugin agents component.",
      sourceUnit: "plugin.alpha.feature:agents",
    });

    const binRoot = await fixture({
      ...OUTCOME_FIXTURE,
      ".skillset/plugins/alpha/bin/tool": `
#!/usr/bin/env bash
echo alpha
`,
    });
    await expectUnsupportedOutcome(binRoot, {
      featureId: "plugin-bin",
      reason: "Codex plugins do not expose a documented plugin-local bin contract.",
      sourceUnit: "plugin.alpha.feature:bin",
    });
  });
});

function outcomeKey(outcome: SkillsetLoweringOutcome): string {
  return `${outcome.sourceUnit}\0${outcome.target ?? ""}\0${outcome.featureId}\0${outcome.status}`;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-lowering-build-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function expectUnsupportedOutcome(
  root: string,
  expected: Pick<SkillsetLoweringOutcome, "featureId" | "reason" | "sourceUnit">
): Promise<void> {
  try {
    await diffSkillsetResult(root);
    throw new Error("expected diffSkillsetResult to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(SkillsetLoweringError);
    const outcomes = (error as SkillsetLoweringError).loweringOutcomes;
    expect(outcomes).toContainEqual(
      expect.objectContaining({
        featureId: expected.featureId,
        policy: "unsupported:error",
        reason: expected.reason,
        sourceUnit: expected.sourceUnit,
        status: "unsupported",
        target: "codex",
      })
    );
  }
}
