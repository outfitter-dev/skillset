import { describe, expect, it } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviderDestinationFormatSnapshot } from "@skillset/provider-formats";

import {
  buildSkillsetResult,
  createOperationalPathContext,
  verifySkillsetResult,
  diffSkillsetResult,
  resolveOperationalPath,
  RENDER_RESULT_STATUS_VALUES,
  SkillsetRenderResultError,
  type SkillsetRenderResult,
  type SkillsetRenderResultStatus,
} from "@skillset/core";

const OUTCOME_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
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
  ".skillset/rules/root.md": `
---
description: Root instructions.
---

Keep generated output deterministic.
`,
  ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
skills:
  - repo-skill
---

Review diffs carefully.
`,
  ".skillset/_codex/rules/deny.rules": `
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

    const codexLock = await readJson(join(root, "plugins-codex/skillset.lock"));
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

    expect(outputPaths).toContain(".skillset/cache/latest/.claude/skills/repo-skill/SKILL.md");
    expect(outputPaths.some((path) => path.startsWith(root))).toBe(false);

    const cacheContext = createOperationalPathContext(root);
    const isolatedLock = await readJson(
      resolveOperationalPath(cacheContext, ".skillset/cache/latest/plugins-codex/skillset.lock")
    );
    const isolatedOutcomes = isolatedLock.renderResults as SkillsetRenderResult[];
    expect(isolatedOutcomes).toContainEqual(
      expect.objectContaining({
        outputs: expect.arrayContaining([
          expect.objectContaining({
            path: ".skillset/cache/latest/plugins-codex/plugins/alpha/skills/plugin-skill/SKILL.md",
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
      destination: "agents",
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
      destination: "bin",
      featureId: "plugin-bin",
      reason: "Codex plugins do not expose a documented plugin-local bin contract.",
      sourceUnit: "plugin.alpha.feature:bin",
    });
  });

  it("enforces unsupported adaptive hook outcomes for Codex component scopes", async () => {
    const skillRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-skill
claude: false
codex: true
`,
      ".skillset/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  Stop:
    - local-stop
---

Body.
`,
      ".skillset/skills/writer/hooks/local-stop.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo skill" },
      }),
    });
    await expectUnsupportedOutcome(skillRoot, {
      destination: "skill-frontmatter",
      featureId: "adaptive-hooks",
      reason: "Codex has no faithful skill-local hook destination for adaptive hook attachments.",
      sourceUnit: "skill:writer",
    });

    const pluginSkillRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-plugin-skill
claude: false
codex: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  Stop:
    - local-stop
---

Body.
`,
      ".skillset/plugins/demo/skills/writer/hooks/local-stop.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo plugin skill" },
      }),
    });
    await expectUnsupportedOutcome(pluginSkillRoot, {
      destination: "skill-frontmatter",
      featureId: "adaptive-hooks",
      reason: "Codex has no faithful skill-local hook destination for adaptive hook attachments.",
      sourceUnit: "plugin.demo.skill:writer",
    });

    const agentRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-agent
claude: false
codex: true
`,
      ".skillset/agents/helper.md": `
---
description: Demo helper.
hooks:
  Stop:
    - local-stop
---

Body.
`,
      ".skillset/agents/helper/hooks/local-stop.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo agent" },
      }),
    });
    await expectUnsupportedOutcome(agentRoot, {
      destination: "agent-frontmatter",
      featureId: "adaptive-hooks",
      reason: "Codex has no faithful project-agent hook destination for adaptive hook attachments.",
      sourceUnit: "agent:helper",
    });
  });

  it("does not report unsupported Codex hook outcomes for Claude-scoped adaptive attachments", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-provider-scope
claude: true
codex: true
`,
      ".skillset/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  Stop:
    - hook: local-stop
      providers: [claude]
---

Body.
`,
      ".skillset/skills/writer/hooks/local-stop.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo skill" },
      }),
    });

    const preview = await diffSkillsetResult(root);

    expect(preview.renderResults).not.toContainEqual(expect.objectContaining({
      featureId: "adaptive-hooks",
      status: "unsupported",
      target: "codex",
    }));
  });

  it("enforces unsupported adaptive hook outcomes for Codex plugin capability gaps", async () => {
    const eventRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-plugin-event
claude: false
codex: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Notification:
    - notify
`,
      ".skillset/plugins/demo/hooks/notify.json": JSON.stringify({
        events: ["Notification"],
        run: { command: "echo notify" },
      }),
    });
    await expectUnsupportedOutcome(eventRoot, {
      destination: "hooks",
      featureId: "adaptive-hooks",
      reason: "Codex does not support adaptive hook event Notification.",
      sourceUnit: "plugin.demo.feature:hooks",
    });

    const matcherRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-plugin-matcher
claude: false
codex: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - hook: stop-policy
      match: main
`,
      ".skillset/plugins/demo/hooks/stop-policy.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo stop" },
      }),
    });
    await expectUnsupportedOutcome(matcherRoot, {
      destination: "hooks",
      featureId: "adaptive-hooks",
      reason: "Codex ignores matchers for adaptive hook event Stop, so this attachment cannot render faithfully.",
      sourceUnit: "plugin.demo.feature:hooks",
    });
  });

  it("enforces unsupported adaptive hook outcomes for render field gaps", async () => {
    const providerOverrideRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-provider-override
claude: true
codex: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        claude: { status: "Checking" },
        events: ["Stop"],
        run: { command: "echo ok" },
      }),
    });
    await expectUnsupportedOutcome(providerOverrideRoot, {
      destination: "hooks",
      featureId: "adaptive-hooks",
      reason: "Adaptive hook shell-policy uses claude provider overrides, but plugin hook rendering does not support overrides yet.",
      sourceUnit: "plugin.demo.feature:hooks",
      target: "claude",
    });

    const runFieldRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-run-field
claude: false
codex: true
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  Stop:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        events: ["Stop"],
        run: { command: "echo ok", env: { CHECK: "1" } },
      }),
    });
    await expectUnsupportedOutcome(runFieldRoot, {
      destination: "hooks",
      featureId: "adaptive-hooks",
      reason: "Adaptive hook shell-policy uses run.env, but plugin hook rendering only supports run.command and run.script yet.",
      sourceUnit: "plugin.demo.feature:hooks",
    });

    const runtimePathRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-frontmatter-script
claude: true
codex: false
`,
      ".skillset/skills/writer/SKILL.md": `
---
name: writer
description: Demo writer.
hooks:
  Stop:
    - local-stop
---

Body.
`,
      ".skillset/skills/writer/hooks/local-stop/hook.json": JSON.stringify({
        events: ["Stop"],
        run: { script: "./stop.sh" },
      }),
      ".skillset/skills/writer/hooks/local-stop/stop.sh": "#!/bin/sh\nexit 0\n",
    });
    await expectUnsupportedOutcome(runtimePathRoot, {
      destination: "skill-frontmatter",
      featureId: "adaptive-hooks",
      reason: "Adaptive hook local-stop uses run.script, but frontmatter hook rendering does not have stable runtime path proof yet.",
      sourceUnit: "skill:writer",
      target: "claude",
    });
  });

  it("separates target (provider) from destination (concrete output scope)", async () => {
    const root = await fixture(OUTCOME_FIXTURE);
    const preview = await diffSkillsetResult(root);

    // Multi-destination under one target: a single source skill renders both the
    // skill artifact and its tool-intent frontmatter scope under claude.
    const claudeSkillDestinations = preview.renderResults
      .filter(
        (result) =>
          result.sourceUnit === "plugin.alpha.skill:plugin-skill" && result.target === "claude"
      )
      .map((result) => result.destination)
      .sort();
    expect(claudeSkillDestinations).toContain("skill");
    expect(claudeSkillDestinations).toContain("skill-frontmatter");

    // The same skill under codex carries a distinct tool-intent destination,
    // proving destination varies by scope while target stays the provider.
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        destination: "skill-tools",
        featureId: "tool-intent",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        target: "codex",
      })
    );
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
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function expectUnsupportedOutcome(
  root: string,
  expected: Pick<SkillsetRenderResult, "destination" | "featureId" | "sourceUnit"> & {
    readonly reason: string;
    readonly target?: "claude" | "codex";
  }
): Promise<void> {
  const target = expected.target ?? "codex";
  const snapshotRef = target === "claude" ? "claude-hooks" : "codex-plugin";
  await expect(buildSkillsetResult(root)).rejects.toThrow("unsupported destination policy blocked 1 render result");
  await expect(verifySkillsetResult(root)).rejects.toThrow("unsupported destination policy blocked 1 render result");
  try {
    await diffSkillsetResult(root);
    throw new Error("expected diffSkillsetResult to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(SkillsetRenderResultError);
    const outcomes = (error as SkillsetRenderResultError).renderResults;
    expect(outcomes).toContainEqual(
      expect.objectContaining({
        destination: expected.destination,
        featureId: expected.featureId,
        policy: "unsupported:error",
        reason: expected.reason,
        evidence: expect.arrayContaining([
          expect.objectContaining({
            kind: "provider-snapshot",
            note: getProviderDestinationFormatSnapshot(snapshotRef)?.provenance.contentHash,
            ref: snapshotRef,
          }),
        ]),
        sourceUnit: expected.sourceUnit,
        status: "unsupported",
        target,
      })
    );
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain("unsupported destination policy blocked 1 render result");
    expect(message).toContain(expected.featureId);
    expect(message).toContain(target);
    expect(message).toContain("unsupported");
    expect(message).toContain(expected.reason);
    expect(message).toContain("suggestion:");
  }
}
