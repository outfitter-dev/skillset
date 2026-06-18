import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSkillsetResult,
  checkSkillsetResult,
  diffSkillsetResult,
  RENDER_RESULT_STATUS_VALUES,
  SkillsetRenderResultError,
  type SkillsetRenderResult,
  type SkillsetRenderResultStatus,
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

describe("build render results", () => {
  it("reports emitted, pass-through, transformed, unsupported, and scoped outcomes", async () => {
    const root = await fixture(OUTCOME_FIXTURE);

    const preview = await diffSkillsetResult(root);
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "standalone-skills",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: ".claude/skills/repo-skill/SKILL.md" }),
        ]),
        sourceUnit: "skill:repo-skill",
        status: "rendered",
        target: "claude",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-skills",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "rendered",
        target: "codex",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "project-instructions",
        sourceUnit: "instruction:AGENTS.md",
        status: "transformed",
        target: "codex",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "project-agents",
        sourceUnit: "agent:reviewer",
        status: "transformed",
        target: "codex",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "target-native-islands",
        sourceUnit: "codex.rules:rules/deny.rules",
        status: "target_native",
        target: "codex",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-mcp",
        sourceUnit: "plugin.alpha.feature:mcp",
        status: "target_native",
        target: "claude",
      })
    );
    expect(preview.renderResults).toContainEqual(
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
    expect(preview.renderResults).toContainEqual(
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
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-apps",
        sourceUnit: "plugin.alpha.feature:app",
        status: "target_native",
        target: "codex",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "dependencies",
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "rendered",
        target: "claude",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "dependencies",
        reason: expect.stringContaining("Codex"),
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "degraded",
        target: "codex",
      })
    );
    expect(preview.renderResults).toContainEqual(
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
    expect(preview.renderResults).toContainEqual(
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
    expect(preview.renderResults).toContainEqual(
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
      expect(preview.renderResults).toContainEqual(
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
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-skills",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "intentionally_skipped",
        target: "claude",
      })
    );
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "standalone-skills",
        sourceUnit: "skill:repo-skill",
        status: "rendered",
      })
    );
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-hooks",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.feature:hooks",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-apps",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.feature:app",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "dependencies",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "tool-intent",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "tool-intent",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "intentionally_skipped",
        target: "claude",
      })
    );
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-commands",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.feature:commands",
        status: "intentionally_skipped",
        target: "claude",
      })
    );

    const build = await buildSkillsetResult(root);
    expect(build.renderResults.map(outcomeKey)).toEqual(preview.renderResults.map(outcomeKey));

    const codexLock = await readJson(join(root, "plugins-codex/.skillset.lock"));
    const codexOutcomes = codexLock.renderResults as SkillsetRenderResult[];
    expect(codexOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-skills",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "rendered",
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
    expect(codexSkill).not.toContain("renderResults");
    expect(JSON.stringify(codexLock)).not.toContain(root);
  });

  it("records isolated output paths relative to the isolated projection root", async () => {
    const root = await fixture(OUTCOME_FIXTURE);
    const preview = await buildSkillsetResult(root, { isolated: true });
    const outputPaths = preview.renderResults.flatMap((outcome) =>
      (outcome.outputs ?? []).map((output) => output.path)
    );

    expect(outputPaths).toContain(".skillset/build/out/.claude/skills/repo-skill/SKILL.md");
    expect(outputPaths.some((path) => path.startsWith(root))).toBe(false);

    const isolatedLock = await readJson(join(root, ".skillset/build/out/plugins-codex/.skillset.lock"));
    const isolatedOutcomes = isolatedLock.renderResults as SkillsetRenderResult[];
    expect(isolatedOutcomes).toContainEqual(
      expect.objectContaining({
        outputs: expect.arrayContaining([
          expect.objectContaining({
            path: ".skillset/build/out/plugins-codex/plugins/alpha/skills/plugin-skill/SKILL.md",
          }),
        ]),
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "rendered",
        target: "codex",
      })
    );
    expect(JSON.stringify(isolatedLock)).not.toContain(root);
  });

  it("covers the v1 outcome status matrix or documents deferrals", async () => {
    const root = await fixture(OUTCOME_FIXTURE);
    const successful = await diffSkillsetResult(root);
    const scoped = await diffSkillsetResult(root, { scopes: ["repo"] });
    const unsupportedRoot = await fixture({
      ...OUTCOME_FIXTURE,
      ".skillset/plugins/alpha/bin/tool": `
#!/usr/bin/env bash
echo alpha
`,
    });
    const unsupported = await renderErrorResults(unsupportedRoot);
    const producedStatuses = statusesInVocabularyOrder([
      ...successful.renderResults,
      ...scoped.renderResults,
      ...unsupported,
    ]);

    expect(producedStatuses).toEqual([
      "degraded",
      "intentionally_skipped",
      "metadata_only",
      "rendered",
      "target_native",
      "transformed",
      "unsupported",
    ]);

    const documentedDeferrals = ["externally_managed", "failed", "lossy"] satisfies readonly SkillsetRenderResultStatus[];
    expect(statusesInVocabularyOrder([...producedStatuses, ...documentedDeferrals])).toEqual([
      ...RENDER_RESULT_STATUS_VALUES,
    ]);
  });

  it("ignores placeholder-only plugin agent directories for unsupported Codex outcomes", async () => {
    const root = await fixture({
      ...OUTCOME_FIXTURE,
      ".skillset/plugins/alpha/agents/.gitkeep": "",
    });

    const result = await buildSkillsetResult(root);

    expect(result.renderResults).not.toContainEqual(expect.objectContaining({
      featureId: "plugin-agents",
      sourceUnit: "plugin.alpha.feature:agents",
      status: "unsupported",
      target: "codex",
    }));
  });

  it("enforces unsupported outcome policy with actionable render errors", async () => {
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

function outcomeKey(outcome: SkillsetRenderResult): string {
  return `${outcome.sourceUnit}\0${outcome.target ?? ""}\0${outcome.featureId}\0${outcome.status}`;
}

function statusesInVocabularyOrder(
  values: readonly (SkillsetRenderResult | SkillsetRenderResultStatus)[]
): readonly SkillsetRenderResultStatus[] {
  const statuses = new Set(values.map((value) => typeof value === "string" ? value : value.status));
  return RENDER_RESULT_STATUS_VALUES.filter((status) => statuses.has(status));
}

async function renderErrorResults(root: string): Promise<readonly SkillsetRenderResult[]> {
  try {
    await diffSkillsetResult(root);
  } catch (error) {
    expect(error).toBeInstanceOf(SkillsetRenderResultError);
    return (error as SkillsetRenderResultError).renderResults;
  }
  throw new Error("expected diffSkillsetResult to reject");
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-render-build-"));
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
  expected: Pick<SkillsetRenderResult, "featureId" | "sourceUnit"> & { readonly reason: string }
): Promise<void> {
  await expect(buildSkillsetResult(root)).rejects.toThrow("unsupported destination policy blocked 1 render result");
  await expect(checkSkillsetResult(root)).rejects.toThrow("unsupported destination policy blocked 1 render result");
  try {
    await diffSkillsetResult(root);
    throw new Error("expected diffSkillsetResult to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(SkillsetRenderResultError);
    const outcomes = (error as SkillsetRenderResultError).renderResults;
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
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain("unsupported destination policy blocked 1 render result");
    expect(message).toContain(expected.featureId);
    expect(message).toContain("codex");
    expect(message).toContain("unsupported");
    expect(message).toContain(expected.reason);
    expect(message).toContain("suggestion:");
  }
}
