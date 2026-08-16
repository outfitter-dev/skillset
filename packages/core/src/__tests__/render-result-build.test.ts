import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviderDestinationFormatSnapshot } from "@skillset/registry";

import {
  buildSkillsetResult,
  createOperationalPathContext,
  verifySkillsetResult,
  diffSkillsetResult,
  resolveOperationalPath,
  RENDER_RESULT_STATUS_VALUES,
  restoreOutputBackup,
  SkillsetRenderResultError,
  type SkillsetRenderResult,
  type SkillsetRenderResultStatus,
} from "@skillset/core";
import { claudeMarketplaceSourcePlugins } from "../render-marketplaces";
import { collectRenderResults } from "../render-result-collector";
import { renderBuildGraph } from "../render";
import { loadBuildGraph } from "../resolver";
import { supportsGeneratedFileModes } from "../generated-file-mode";

const OUTCOME_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: outcome-root
  marketplace:
    name: outcome-market
claude: true
codex: true
cursor: false
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
tools:
  read: true
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
cursor: false
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
  it("preserves and repairs executable modes for resources and plugin scripts", async () => {
    if (!supportsGeneratedFileModes()) return;

    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: executable-output
claude: true
codex: true
cursor: false
`,
      ".skillset/shared/scripts/run.sh": "#!/bin/sh\necho resource\n",
      ".skillset/skills/resourceful/SKILL.md": `
---
name: resourceful
description: Uses an executable resource.
resources:
  scripts:
    - shared:scripts/run.sh
---

Run scripts/run.sh.
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
`,
      ".skillset/plugins/demo/hooks/hooks.json": JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ command: "$CLAUDE_PLUGIN_ROOT/scripts/detect.sh", type: "command" }] }],
        },
      }),
      ".skillset/plugins/demo/scripts/detect.sh": "#!/bin/sh\necho plugin\n",
    });
    const resourceSource = join(root, ".skillset/shared/scripts/run.sh");
    const pluginSource = join(root, ".skillset/plugins/demo/scripts/detect.sh");
    await chmod(resourceSource, 0o755);
    await chmod(pluginSource, 0o755);

    await buildSkillsetResult(root);

    const resourceOutput = join(root, ".agents/skills/resourceful/scripts/run.sh");
    const pluginOutput = join(root, "plugins/demo/claude/scripts/detect.sh");
    expect((await stat(resourceOutput)).mode & 0o777).toBe(0o755);
    expect((await stat(pluginOutput)).mode & 0o777).toBe(0o755);

    const skillLock = await readJson(join(root, ".agents/skills/skillset.lock"));
    const skillItem = (skillLock.items as Array<Record<string, unknown>>)
      .find((item) => item.name === "resourceful");
    expect(skillItem?.fileModes).toEqual(expect.objectContaining({
      "resourceful/scripts/run.sh": "0755",
    }));
    const pluginLock = await readJson(join(root, "plugins/skillset.lock"));
    const pluginItem = (pluginLock.items as Array<Record<string, unknown>>)
      .find((item) => item.name === "demo" && item.kind === "plugin");
    expect(pluginItem?.files).toEqual(expect.arrayContaining([
      "demo/claude/hooks/hooks.json",
      "demo/claude/scripts/detect.sh",
    ]));
    expect(pluginItem?.fileModes).toEqual(expect.objectContaining({
      "demo/claude/scripts/detect.sh": "0755",
    }));
    await chmod(pluginSource, 0o644);
    await buildSkillsetResult(root);
    const pluginModeChangedLock = await readJson(join(root, "plugins/skillset.lock"));
    const pluginModeChangedItem = (pluginModeChangedLock.items as Array<Record<string, unknown>>)
      .find((item) => item.name === "demo" && item.kind === "plugin");
    expect(pluginModeChangedItem?.sourceHash).not.toBe(pluginItem?.sourceHash);
    expect(pluginModeChangedItem?.fileModes).toEqual(expect.objectContaining({
      "demo/claude/scripts/detect.sh": "0644",
    }));

    await chmod(resourceOutput, 0o555);
    const verification = await verifySkillsetResult(root);
    expect(verification.ok).toBe(false);
    expect(verification.data.failures).toContain(
      "stale generated file mode: .agents/skills/resourceful/scripts/run.sh; expected 0755, found 0555"
    );
    expect((await diffSkillsetResult(root)).data.changed).toContain(
      ".agents/skills/resourceful/scripts/run.sh"
    );

    const repaired = await buildSkillsetResult(root);
    expect(repaired.writes.writtenPaths).toContain(
      ".agents/skills/resourceful/scripts/run.sh"
    );
    expect((await stat(resourceOutput)).mode & 0o777).toBe(0o755);
    expect(repaired.writes.backupRunId).toBeDefined();

    await chmod(resourceOutput, 0o700);
    await expect(
      restoreOutputBackup(root, repaired.writes.backupRunId ?? "", { write: true })
    ).rejects.toThrow("target mode changed since backup 0755");
    await chmod(resourceOutput, 0o755);
    await restoreOutputBackup(root, repaired.writes.backupRunId ?? "", { write: true });
    expect((await stat(resourceOutput)).mode & 0o777).toBe(0o555);
  });

  it("keeps project-agent source hashes stable when only compile.skillset.metadata changes", async () => {
    const config = (metadata: boolean): string => `
skillset:
  name: agent-metadata-toggle
compile:
  build: all
  skillset:
    metadata: ${metadata}
claude: true
codex: false
cursor: false
`;
    const root = await fixture({
      "skillset.yaml": config(true),
      ".skillset/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
---

Review diffs carefully.
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Demo.
`,
    });

    await buildSkillsetResult(root);
    const agentHash = await projectAgentSourceHash(root);
    const skillHash = await skillSourceHash(root);
    expect(agentHash).toBeDefined();
    expect(skillHash).toBeDefined();

    await writeFile(join(root, "skillset.yaml"), `${config(false).trim()}\n`);
    await buildSkillsetResult(root);

    expect(await projectAgentSourceHash(root)).toBe(agentHash);
    expect(await skillSourceHash(root)).not.toBe(skillHash);
  });

  it("upgrades schema-v1 output locks without false managed-edit backups", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: legacy-lock-mode
claude: false
codex: true
cursor: false
`,
      ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
resources:
  scripts:
    - shared:scripts/run.sh
---

Demo.
`,
      ".skillset/shared/scripts/run.sh": "#!/bin/sh\necho legacy\n",
    });
    const sourceScript = join(root, ".skillset/shared/scripts/run.sh");
    const outputScript = join(root, ".agents/skills/demo/scripts/run.sh");
    await chmod(sourceScript, 0o755);
    await buildSkillsetResult(root);

    const outputRoot = join(root, ".agents/skills");
    const lockPath = join(outputRoot, "skillset.lock");
    const legacy = await readJson(lockPath) as {
      items: Array<{ fileModes?: Record<string, string>; files: string[]; outputHash: string }>;
      provenanceHash?: string;
      schemaVersion: number;
    };
    legacy.schemaVersion = 1;
    delete legacy.provenanceHash;
    for (const item of legacy.items) {
      const hash = createHash("sha256");
      hash.update("skillset-output-v1\0");
      for (const file of item.files) {
        hash.update(file);
        hash.update("\0");
        hash.update(await readFile(join(outputRoot, file)));
        hash.update("\0");
      }
      item.outputHash = `sha256:${hash.digest("hex")}`;
      delete item.fileModes;
    }
    await writeFile(lockPath, `${JSON.stringify(legacy, null, 2)}\n`);
    await chmod(outputScript, 0o644);

    const migrated = await buildSkillsetResult(root);
    expect(migrated.writes.backupRunId).toBeUndefined();
    expect(migrated.writes.writtenPaths).toContain(
      ".agents/skills/demo/scripts/run.sh"
    );
    expect(migrated.writes.writtenPaths).toContain(".agents/skills/skillset.lock");
    expect((await stat(outputScript)).mode & 0o777).toBe(0o755);
    expect((await readJson(lockPath)).schemaVersion).toBe(2);
    expect((await verifySkillsetResult(root)).ok).toBe(true);
  });

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
          expect.objectContaining({ path: "plugins/beta/claude/bin/tool" }),
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
          expect.objectContaining({ path: "plugins/alpha/codex/hooks/hooks.json" }),
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
        outputs: expect.arrayContaining([
          expect.objectContaining({
            kind: "plugin-skill",
            path: "plugins/alpha/codex/skills/plugin-skill/SKILL.md",
          }),
        ]),
        reason: expect.stringContaining("Codex"),
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "degraded",
        target: "codex",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "tools-policy",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: "plugins/alpha/claude/skills/plugin-skill/SKILL.md" }),
        ]),
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "transformed",
        target: "claude",
      })
    );
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "tools-policy",
        outputs: expect.arrayContaining([
          expect.objectContaining({ path: "plugins/alpha/codex/skills/plugin-skill/.skillset.tools.yaml" }),
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
          expect.objectContaining({ path: "plugins/beta/claude/agents/reviewer.md" }),
        ]),
        sourceUnit: "plugin.beta.feature:agents",
        status: "target_native",
        target: "claude",
      })
    );
    const companionExpectations = [
      {
        featureId: "plugin-readme",
        path: "plugins/alpha/claude/README.md",
        sourceUnit: "plugin.alpha.feature:readme",
        target: "claude",
      },
      {
        featureId: "plugin-assets",
        path: "plugins/alpha/codex/assets/icon.txt",
        sourceUnit: "plugin.alpha.feature:assets",
        target: "codex",
      },
      {
        featureId: "plugin-scripts",
        path: "plugins/alpha/codex/scripts/setup.sh",
        sourceUnit: "plugin.alpha.feature:scripts",
        target: "codex",
      },
      {
        featureId: "plugin-src",
        path: "plugins/alpha/codex/src/index.js",
        sourceUnit: "plugin.alpha.feature:src",
        target: "codex",
      },
      {
        featureId: "plugin-commands",
        path: "plugins/alpha/claude/commands/run.md",
        sourceUnit: "plugin.alpha.feature:commands",
        target: "claude",
      },
      {
        featureId: "plugin-lsp-servers",
        path: "plugins/alpha/claude/.lsp.json",
        sourceUnit: "plugin.alpha.feature:lsp-servers",
        target: "claude",
      },
      {
        featureId: "plugin-output-styles",
        path: "plugins/alpha/claude/output-styles/focused.md",
        sourceUnit: "plugin.alpha.feature:output-styles",
        target: "claude",
      },
      {
        featureId: "plugin-themes",
        path: "plugins/alpha/claude/themes/dark.json",
        sourceUnit: "plugin.alpha.feature:themes",
        target: "claude",
      },
      {
        featureId: "plugin-monitors",
        path: "plugins/alpha/claude/monitors/monitors.json",
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
        featureId: "tools-policy",
        policy: "scope:excluded",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "intentionally_skipped",
        target: "codex",
      })
    );
    expect(scoped.renderResults).toContainEqual(
      expect.objectContaining({
        featureId: "tools-policy",
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

    const pluginLock = await readJson(join(root, "plugins/skillset.lock"));
    const pluginOutcomes = pluginLock.renderResults as SkillsetRenderResult[];
    expect(pluginOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-skills",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        status: "rendered",
        target: "codex",
      })
    );
    expect(pluginOutcomes).toContainEqual(
      expect.objectContaining({
        featureId: "dependencies",
        sourceUnit: "plugin.alpha.feature:dependencies",
        status: "degraded",
        target: "codex",
      })
    );
    expect(pluginOutcomes).toContainEqual(
      expect.objectContaining({
        sourceUnit: "plugin.beta.feature:bin",
        target: "claude",
      })
    );
    expect(pluginLock.items).toContainEqual(
      expect.objectContaining({
        feature: "app",
        validation: "structured",
      })
    );

    const codexSkill = await readFile(join(root, "plugins/alpha/codex/skills/plugin-skill/SKILL.md"), "utf8");
    expect(codexSkill).not.toContain("renderResults");
    expect(JSON.stringify(pluginLock)).not.toContain(root);
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
      resolveOperationalPath(cacheContext, ".skillset/cache/latest/plugins/skillset.lock")
    );
    const isolatedOutcomes = isolatedLock.renderResults as SkillsetRenderResult[];
    expect(isolatedOutcomes).toContainEqual(
      expect.objectContaining({
        outputs: expect.arrayContaining([
          expect.objectContaining({
            path: ".skillset/cache/latest/plugins/alpha/codex/skills/plugin-skill/SKILL.md",
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

  it("reports Cursor dependencies as unsupported without fabricated outputs", async () => {
    const source = {
      "skillset.yaml": `
skillset:
  name: cursor-dependency
compile:
  targets: [cursor]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
dependencies:
  plugins:
    - name: external-tools
      range: ^1.0.0
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
name: helper
description: Helper skill.
---

Help with the task.
`,
    };
    const warningRoot = await fixture(source);
    const warning = await diffSkillsetResult(warningRoot);
    const cursorDependency = warning.renderResults.find(
      (result) =>
        result.featureId === "dependencies" && result.target === "cursor"
    );
    expect(cursorDependency).toMatchObject({
      sourceUnit: "plugin.tools.feature:dependencies",
      status: "unsupported",
    });
    expect(cursorDependency?.outputs).toBeUndefined();

    const errorRoot = await fixture({
      ...source,
      "skillset.yaml": source["skillset.yaml"].replace(
        "unsupportedDestination: warn",
        "unsupportedDestination: error"
      ),
    });
    await expect(diffSkillsetResult(errorRoot)).rejects.toThrow(
      "unsupported destination policy blocked 1 render result"
    );
  });

  it("does not claim a degraded Codex dependency without an emitted notice", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: codex-dependency
compile:
  targets: [codex]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
dependencies:
  plugins:
    - name: external-tools
      range: ^1.0.0
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const graph = await loadBuildGraph(root);
    const rendered = (await renderBuildGraph(graph)).filter(
      (file) => !file.path.endsWith("/SKILL.md")
    );
    const results = collectRenderResults(graph, rendered, {
      claudeMarketplacePlugins: await claudeMarketplaceSourcePlugins(graph),
      includedPaths: new Set(rendered.map((file) => file.path)),
    });
    const dependency = results.find(
      (result) =>
        result.featureId === "dependencies" && result.target === "codex"
    );
    expect(dependency).toMatchObject({
      sourceUnit: "plugin.tools.feature:dependencies",
      status: "unsupported",
    });
    expect(dependency?.outputs).toBeUndefined();
  });

  it("reports Claude author fields that cannot be represented", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: author-evidence
compile:
  targets: [claude]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  author:
    name: Tools Team
    email: tools@example.com
    contributor: Example Contributor
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const preview = await diffSkillsetResult(root);
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({
            code: "render/claude-author-fields-omitted",
            path: ".skillset/plugins/tools: $.skillset.author",
          }),
        ],
        destination: "plugin-manifest",
        featureId: "plugin-manifests",
        reason:
          "Claude author output supports only name, email, and url; omitted canonical fields: contributor",
        sourcePath: ".skillset/plugins/tools",
        sourceUnit: "plugin.tools.config:root",
        status: "lossy",
        target: "claude",
      })
    );
  });

  it("attributes inherited Claude author omissions to root metadata", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: author-evidence
  author:
    name: Root Team
    contributor: Example Contributor
compile:
  targets: [claude]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const preview = await diffSkillsetResult(root);
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({
            code: "render/claude-author-fields-omitted",
            path: "skillset.yaml: $.skillset.author",
          }),
        ],
        destination: "plugin-manifest",
        sourcePath: "skillset.yaml",
        sourceUnit: "plugin.tools.config:root",
        status: "lossy",
        target: "claude",
      })
    );
  });

  it("reports Cursor author URL omission with plugin-local provenance", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: author-evidence
compile:
  targets: [cursor]
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  author:
    name: Tools Team
    email: tools@example.com
    url: https://example.com/tools
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const preview = await diffSkillsetResult(root);
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({
            code: "render/cursor-author-fields-omitted",
            path: ".skillset/plugins/tools: $.skillset.author",
          }),
        ],
        destination: "plugin-manifest",
        reason:
          "Cursor author output supports only name and email; omitted canonical fields: url",
        sourcePath: ".skillset/plugins/tools",
        sourceUnit: "plugin.tools.config:root",
        status: "degraded",
        target: "cursor",
      })
    );
  });

  const portableManifestReason = (target: string, field: string): string => {
    const label =
      target === "claude" ? "Claude" : target === "codex" ? "Codex" : "Cursor";
    // Only the pinned Cursor plugin manifest has a native destination field for
    // these portable values, so only Cursor gets the escape-hatch advice.
    const escape =
      target === "cursor"
        ? `; move the value to cursor.manifest.${field} to keep the Cursor-native field`
        : "";
    return (
      `${label} plugin output has no verified runtime destination for portable manifest.${field}; ` +
      `omitted canonical field: manifest.${field}; ` +
      `no enabled target renders this field, so the authored value is dropped${escape}`
    );
  };

  const LISTING_CATEGORY_DEGRADED_REASON =
    "Cursor plugin output has no verified runtime destination for canonical listing.category; " +
    "omitted canonical field: listing.category; " +
    "still rendered by enabled target: Codex interface.category";
  const LISTING_CATEGORY_LOSSY_REASON =
    "Cursor plugin output has no verified runtime destination for canonical listing.category; " +
    "omitted canonical field: listing.category; " +
    "no enabled target renders this category, so the authored value is dropped; " +
    "move the value to cursor.manifest.category to keep the Cursor-native field";

  it("reports canonical listing category omitted from Cursor plugin output while Codex still renders it", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: listing-evidence
compile:
  targets: [codex, cursor]
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  listing:
    category: Developer Tools
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const build = await buildSkillsetResult(root);
    const manifestResults = build.renderResults.filter(
      (outcome) =>
        outcome.sourceUnit === "plugin.tools.config:root" &&
        outcome.featureId === "plugin-manifests" &&
        outcome.target === "cursor"
    );
    expect(manifestResults).toHaveLength(1);
    expect(manifestResults[0]).toMatchObject({
      diagnostics: [
        {
          code: "render/cursor-listing-category-omitted",
          message: LISTING_CATEGORY_DEGRADED_REASON,
          path: ".skillset/plugins/tools: $.skillset.listing.category",
        },
      ],
      destination: "plugin-manifest",
      reason: LISTING_CATEGORY_DEGRADED_REASON,
      sourcePath: ".skillset/plugins/tools",
      status: "degraded",
    });

    const manifest = await readJson(
      join(root, "plugins/tools/cursor/.cursor-plugin/plugin.json")
    );
    expect(manifest.category).toBeUndefined();
    // The degraded classification is only true because this enabled Codex
    // target really does render the same authored category.
    const codexManifest = await readJson(
      join(root, "plugins/tools/codex/.codex-plugin/plugin.json")
    );
    expect(
      (codexManifest.interface as Record<string, unknown>).category
    ).toBe("Developer Tools");
  });

  it("blocks default builds when no enabled target renders the canonical listing category", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: listing-only-cursor
compile:
  targets: [cursor]
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  listing:
    category: Developer Tools
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    await expect(buildSkillsetResult(root)).rejects.toThrow(
      SkillsetRenderResultError
    );
  });

  it("reports the canonical listing category as lossy in a Cursor-only workspace", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: listing-only-cursor
compile:
  targets: [cursor]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  listing:
    category: Developer Tools
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const build = await buildSkillsetResult(root);
    const manifestResults = build.renderResults.filter(
      (outcome) =>
        outcome.sourceUnit === "plugin.tools.config:root" &&
        outcome.featureId === "plugin-manifests" &&
        outcome.target === "cursor"
    );
    expect(manifestResults).toHaveLength(1);
    expect(manifestResults[0]).toMatchObject({
      diagnostics: [
        {
          code: "render/cursor-listing-category-omitted",
          message: LISTING_CATEGORY_LOSSY_REASON,
          path: ".skillset/plugins/tools: $.skillset.listing.category",
        },
      ],
      destination: "plugin-manifest",
      reason: LISTING_CATEGORY_LOSSY_REASON,
      sourcePath: ".skillset/plugins/tools",
      status: "lossy",
    });

    const manifest = await readJson(
      join(root, "plugins/tools/cursor/.cursor-plugin/plugin.json")
    );
    expect(manifest.category).toBeUndefined();
  });

  it("reports the canonical listing category as lossy when the plugin opts out of the faithful target", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: listing-plugin-optout
compile:
  targets: [codex, cursor]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  listing:
    category: Developer Tools
codex: false
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const build = await buildSkillsetResult(root);
    const manifestResults = build.renderResults.filter(
      (outcome) =>
        outcome.sourceUnit === "plugin.tools.config:root" &&
        outcome.featureId === "plugin-manifests" &&
        outcome.target === "cursor"
    );
    expect(manifestResults).toHaveLength(1);
    expect(manifestResults[0]).toMatchObject({
      reason: LISTING_CATEGORY_LOSSY_REASON,
      status: "lossy",
    });
  });

  it.each([
    ["codex.interface", "codex:\n  interface:\n    category: Developer Tools"],
    [
      "codex.manifest.interface",
      "codex:\n  manifest:\n    interface:\n      category: Developer Tools",
    ],
  ])(
    "keeps the canonical listing category degraded when a %s override repeats it",
    async (_label, overrideYaml) => {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: listing-override-equal
compile:
  targets: [codex, cursor]
  unsupportedDestination: warn
`,
        ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  listing:
    category: Developer Tools
${overrideYaml}
`,
        ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      });

      const build = await buildSkillsetResult(root);
      const manifestResults = build.renderResults.filter(
        (outcome) =>
          outcome.sourceUnit === "plugin.tools.config:root" &&
          outcome.featureId === "plugin-manifests" &&
          outcome.target === "cursor"
      );
      expect(manifestResults).toHaveLength(1);
      expect(manifestResults[0]).toMatchObject({
        reason: LISTING_CATEGORY_DEGRADED_REASON,
        status: "degraded",
      });

      const codexManifest = await readJson(
        join(root, "plugins/tools/codex/.codex-plugin/plugin.json")
      );
      expect(
        (codexManifest.interface as Record<string, unknown>).category
      ).toBe("Developer Tools");
    }
  );

  it.each([
    ["codex.interface", "codex:\n  interface:\n    category: Productivity"],
    [
      "codex.manifest.interface",
      "codex:\n  manifest:\n    interface:\n      category: Productivity",
    ],
  ])(
    "reports the canonical listing category as lossy when a %s override replaces it",
    async (_label, overrideYaml) => {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: listing-override-differs
compile:
  targets: [codex, cursor]
  unsupportedDestination: warn
`,
        ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  listing:
    category: Developer Tools
${overrideYaml}
`,
        ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      });

      const build = await buildSkillsetResult(root);
      const manifestResults = build.renderResults.filter(
        (outcome) =>
          outcome.sourceUnit === "plugin.tools.config:root" &&
          outcome.featureId === "plugin-manifests" &&
          outcome.target === "cursor"
      );
      expect(manifestResults).toHaveLength(1);
      expect(manifestResults[0]).toMatchObject({
        reason: LISTING_CATEGORY_LOSSY_REASON,
        status: "lossy",
      });

      // The Codex destination is selected, but it no longer carries the
      // authored category, so no enabled target preserves the value.
      const codexManifest = await readJson(
        join(root, "plugins/tools/codex/.codex-plugin/plugin.json")
      );
      expect(
        (codexManifest.interface as Record<string, unknown>).category
      ).toBe("Productivity");
    }
  );

  it.each([
    ["category", "category: Developer Tools"],
    ["presentation.category", "presentation:\n    category: Developer Tools"],
  ])(
    "reports compatibility listing category %s omitted from Cursor plugin output",
    async (authoredKey, authoredYaml) => {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: listing-compat-evidence
compile:
  targets: [codex, cursor]
`,
        ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  ${authoredYaml}
`,
        ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      });

      const build = await buildSkillsetResult(root);
      const manifestResults = build.renderResults.filter(
        (outcome) =>
          outcome.sourceUnit === "plugin.tools.config:root" &&
          outcome.featureId === "plugin-manifests" &&
          outcome.target === "cursor"
      );
      expect(manifestResults).toHaveLength(1);
      expect(manifestResults[0]).toMatchObject({
        diagnostics: [
          {
            code: "render/cursor-listing-category-omitted",
            message: LISTING_CATEGORY_DEGRADED_REASON,
            path: `.skillset/plugins/tools: $.skillset.${authoredKey}`,
          },
        ],
        destination: "plugin-manifest",
        status: "degraded",
      });

      const manifest = await readJson(
        join(root, "plugins/tools/cursor/.cursor-plugin/plugin.json")
      );
      expect(manifest.category).toBeUndefined();
    }
  );

  it.each(["claude", "codex", "cursor"])(
    "blocks default builds when portable manifest fields have no %s destination",
    async (target) => {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: portable-manifest-single-target
compile:
  targets: [${target}]
`,
        ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  manifest:
    category: Developer Tools
`,
        ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      });

      await expect(buildSkillsetResult(root)).rejects.toThrow(
        SkillsetRenderResultError
      );
    }
  );

  it("reports portable manifest omissions on every enabled target", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: portable-manifest-every-target
compile:
  targets: [claude, codex, cursor]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  manifest:
    category: Developer Tools
    tags: [review]
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const build = await buildSkillsetResult(root);
    const manifestResults = build.renderResults.filter(
      (outcome) =>
        outcome.sourceUnit === "plugin.tools.config:root" &&
        outcome.featureId === "plugin-manifests"
    );
    expect(
      manifestResults.map((outcome) => [outcome.target, outcome.status])
    ).toEqual([
      ["claude", "lossy"],
      ["codex", "lossy"],
      ["cursor", "lossy"],
    ]);
    expect(
      manifestResults.flatMap((outcome) =>
        (outcome.diagnostics ?? []).map((diagnostic) => diagnostic.message)
      )
    ).toEqual([
      portableManifestReason("claude", "category"),
      portableManifestReason("claude", "tags"),
      portableManifestReason("codex", "category"),
      portableManifestReason("codex", "tags"),
      portableManifestReason("cursor", "category"),
      portableManifestReason("cursor", "tags"),
    ]);
  });

  it.each(["category", "tags"])(
    "blocks default builds when portable manifest.%s has no Cursor destination",
    async (field) => {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: portable-manifest-evidence
compile:
  targets: [cursor]
`,
        ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  manifest:
    ${field === "tags" ? "tags: [review]" : "category: Developer Tools"}
`,
        ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      });

      await expect(buildSkillsetResult(root)).rejects.toThrow(
        SkillsetRenderResultError
      );
    }
  );

  it.each(["category", "tags"])(
    "reports portable manifest.%s omitted from Cursor plugin output",
    async (field) => {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: portable-manifest-evidence
compile:
  targets: [cursor]
  unsupportedDestination: warn
`,
        ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  manifest:
    ${field === "tags" ? "tags: [review]" : "category: Developer Tools"}
`,
        ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      });

      const build = await buildSkillsetResult(root);
      const manifestResults = build.renderResults.filter(
        (outcome) =>
          outcome.sourceUnit === "plugin.tools.config:root" &&
          outcome.featureId === "plugin-manifests" &&
          outcome.target === "cursor"
      );
      expect(manifestResults).toHaveLength(1);
      expect(manifestResults[0]).toMatchObject({
        diagnostics: [
          {
            code: "render/cursor-portable-manifest-field-omitted",
            message: portableManifestReason("cursor", field),
            path: `.skillset/plugins/tools: $.skillset.manifest.${field}`,
          },
        ],
        destination: "plugin-manifest",
        status: "lossy",
      });

      const manifest = await readJson(
        join(root, "plugins/tools/cursor/.cursor-plugin/plugin.json")
      );
      expect(manifest[field]).toBeUndefined();
    }
  );

  it("reports canonical listing and portable manifest omissions together", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: combined-manifest-evidence
compile:
  targets: [cursor]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  category: Developer Tools
  manifest:
    category: Legacy Category
    tags: [review]
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const build = await buildSkillsetResult(root);
    const manifestResults = build.renderResults.filter(
      (outcome) =>
        outcome.sourceUnit === "plugin.tools.config:root" &&
        outcome.featureId === "plugin-manifests" &&
        outcome.target === "cursor"
    );
    expect(manifestResults).toHaveLength(1);
    expect(
      manifestResults[0]?.diagnostics?.map((diagnostic) => diagnostic.path)
    ).toEqual([
      ".skillset/plugins/tools: $.skillset.category",
      ".skillset/plugins/tools: $.skillset.manifest.category",
      ".skillset/plugins/tools: $.skillset.manifest.tags",
    ]);
    expect(manifestResults[0]?.status).toBe("lossy");
  });

  it("allows default multi-provider builds when Cursor only omits author URL", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: author-evidence
  author:
    name: Root Team
    email: root@example.com
    url: https://example.com/root
claude: true
codex: true
cursor: true
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const build = await buildSkillsetResult(root, { isolated: true });
    const cursorAuthorOmissions = build.renderResults.filter((outcome) =>
      outcome.diagnostics?.some((diagnostic) =>
        diagnostic.code.includes("cursor") &&
        diagnostic.code.endsWith("author-fields-omitted")
      )
    );
    expect(cursorAuthorOmissions).toHaveLength(2);
    expect(cursorAuthorOmissions.map((outcome) => outcome.status)).toEqual([
      "degraded",
      "degraded",
    ]);
    expect(
      cursorAuthorOmissions.every((outcome) => outcome.reason?.endsWith("url"))
    ).toBe(true);
  });

  it("keeps additional Cursor author omissions policy-blocking", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: author-evidence
compile:
  targets: [cursor]
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  author:
    name: Tools Team
    url: https://example.com/tools
    contributor: Example Contributor
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    try {
      await buildSkillsetResult(root, { isolated: true });
      throw new Error("expected a true Cursor author loss to block the build");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillsetRenderResultError);
      expect((error as SkillsetRenderResultError).renderResults).toContainEqual(
        expect.objectContaining({
          diagnostics: [
            expect.objectContaining({
              code: "render/cursor-author-fields-omitted",
            }),
          ],
          reason:
            "Cursor author output supports only name and email; omitted canonical fields: contributor, url",
          status: "lossy",
          target: "cursor",
        })
      );
    }
  });

  it("reports unsupported Codex structured-author fields", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: author-evidence
compile:
  targets: [codex]
  unsupportedDestination: warn
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  author:
    name: Tools Team
    contributor: Example Contributor
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const preview = await diffSkillsetResult(root);
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({
            code: "render/codex-author-fields-omitted",
          }),
        ],
        reason:
          "Codex author output supports only name, email, and url; omitted canonical fields: contributor",
        status: "lossy",
        target: "codex",
      })
    );
  });

  it("reports Claude marketplace author omissions once per destination", async () => {
    const cases = [
      {
        expectedPath: "marketplace.owner",
        pluginAuthor: `
  author:
    name: Plugin Team
`,
        rootIdentity: `
  author:
    name: Root Team
  owner:
    name: Publishing Team
    contributor: Publisher
`,
      },
      {
        expectedPath: "marketplace.owner",
        pluginAuthor: `
  author:
    name: Plugin Team
`,
        rootIdentity: `
  author:
    name: Root Team
    contributor: Root Contributor
`,
      },
      {
        expectedPath: "marketplace.plugins.tools.author",
        pluginAuthor: `
  author:
    name: Plugin Team
    contributor: Plugin Contributor
`,
        rootIdentity: `
  author:
    name: Root Team
`,
      },
    ] as const;

    for (const testCase of cases) {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: marketplace-evidence
${testCase.rootIdentity}
compile:
  targets: [claude]
  unsupportedDestination: warn
`,
        ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
${testCase.pluginAuthor}
`,
        ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      });

      const preview = await diffSkillsetResult(root);
      const marketplaceOutcomes = preview.renderResults.filter(
        (outcome) => outcome.featureId === "marketplaces"
      );
      expect(marketplaceOutcomes).toHaveLength(2);
      const diagnostics = marketplaceOutcomes.flatMap(
        (outcome) => outcome.diagnostics ?? []
      );
      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: "render/claude-marketplace-author-fields-omitted",
          path: testCase.expectedPath,
        }),
      ]);
      expect(
        marketplaceOutcomes.filter((outcome) => outcome.status === "lossy")
      ).toHaveLength(1);
    }
  });

  it("reports Cursor marketplace owner omissions for explicit owner and author fallback", async () => {
    const cases = [
      {
        rootIdentity: `
  author:
    name: Root Team
  owner:
    name: Publishing Team
    url: https://example.com/publisher
    contributor: Publisher
`,
      },
      {
        rootIdentity: `
  author:
    name: Root Team
    url: https://example.com/root
    contributor: Root Contributor
`,
      },
    ];

    for (const { rootIdentity } of cases) {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: cursor-marketplace-author-evidence
${rootIdentity}
compile:
  targets: [cursor]
  unsupportedDestination: warn
`,
        ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  author:
    name: Plugin Team
`,
        ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      });

      const preview = await diffSkillsetResult(root);
      expect(preview.renderResults).toContainEqual(
        expect.objectContaining({
          diagnostics: [
            expect.objectContaining({
              code: "render/cursor-marketplace-author-fields-omitted",
              path: "marketplace.owner",
            }),
          ],
          destination: "marketplace",
          featureId: "marketplaces",
          outputs: [
            expect.objectContaining({
              path: ".cursor-plugin/marketplace.json",
            }),
          ],
          reason:
            "Cursor marketplace author output supports only name and email; omitted canonical fields: contributor, url",
          sourcePath: "skillset.yaml",
          sourceUnit: "config:root",
          status: "lossy",
          target: "cursor",
        })
      );
    }
  });

  it("tracks marketplace authors through a replaced Claude marketplace plugin array", async () => {
    const files = (args: {
      readonly droppedAuthor: string;
      readonly keptAuthor: string;
      readonly unsupportedDestination: string;
    }): Record<string, string> => ({
      "skillset.yaml": `
skillset:
  name: marketplace-override
  author:
    name: Root Team
compile:
  targets: [claude]
${args.unsupportedDestination}
claude:
  marketplace:
    plugins:
      - name: kept
        source: ./plugins/kept/claude
`,
      ".skillset/plugins/kept/skillset.yaml": `
skillset:
  name: kept
  author:
    name: Kept Team
${args.keptAuthor}
`,
      ".skillset/plugins/kept/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
      ".skillset/plugins/dropped/skillset.yaml": `
skillset:
  name: dropped
  author:
    name: Dropped Team
${args.droppedAuthor}
`,
      ".skillset/plugins/dropped/skills/helper/SKILL.md": `
---
description: Help with other repository tasks.
---

Help with the other task.
`,
    });

    // The root override replaces the generated plugin array wholesale, so only
    // `kept` reaches the marketplace.
    const warnRoot = await fixture(
      files({
        droppedAuthor: "    sponsor: Dropped Sponsor",
        keptAuthor: "    contributor: Kept Contributor",
        unsupportedDestination: "  unsupportedDestination: warn",
      })
    );
    const preview = await diffSkillsetResult(warnRoot);
    const marketplaceOutcomes = preview.renderResults.filter(
      (outcome) => outcome.featureId === "marketplaces"
    );
    expect(
      marketplaceOutcomes.flatMap((outcome) => outcome.diagnostics ?? [])
    ).toEqual([
      expect.objectContaining({
        code: "render/claude-marketplace-author-fields-omitted",
        path: "marketplace.plugins.kept.author",
      }),
    ]);
    expect(
      [...marketplaceOutcomes.map((outcome) => outcome.sourceUnit)].sort()
    ).toEqual(["config:root", "plugin.kept.config:root"]);

    const built = await buildSkillsetResult(warnRoot);
    const marketplace = await readJson(
      join(warnRoot, ".claude-plugin/marketplace.json")
    );
    expect(built.writes.writtenPaths).toContain(
      ".claude-plugin/marketplace.json"
    );
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: "kept" }),
    ]);

    // An extra canonical author field on the replaced-away plugin is absent
    // from the marketplace, so it must not block the build.
    const droppedOnlyRoot = await fixture(
      files({
        droppedAuthor: "    sponsor: Dropped Sponsor",
        keptAuthor: "",
        unsupportedDestination: "",
      })
    );
    await expect(
      buildSkillsetResult(droppedOnlyRoot, { scopes: ["project"] })
    ).resolves.toBeDefined();

    // The same extra field on the plugin the override keeps still blocks.
    const keptOnlyRoot = await fixture(
      files({
        droppedAuthor: "",
        keptAuthor: "    contributor: Kept Contributor",
        unsupportedDestination: "",
      })
    );
    await expect(
      buildSkillsetResult(keptOnlyRoot, { scopes: ["project"] })
    ).rejects.toThrow(
      "Claude marketplace author output supports only name, email, and url; omitted canonical fields: contributor"
    );
  });

  it("reports author fields a Claude marketplace override drops from the emitted entry", async () => {
    const files = (unsupportedDestination: string): Record<string, string> => ({
      "skillset.yaml": `
skillset:
  name: marketplace-override
  author:
    name: Root Team
compile:
  targets: [claude]
${unsupportedDestination}
claude:
  marketplace:
    plugins:
      - name: kept
        source: ./plugins/kept/claude
        author:
          name: Kept Team
`,
      ".skillset/plugins/kept/skillset.yaml": `
skillset:
  name: kept
  author:
    name: Kept Team
    email: kept@example.com
`,
      ".skillset/plugins/kept/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    // The override keeps the entry's identity but replaces its author with a
    // name-only record, so the plugin's email never reaches the marketplace
    // even though `email` is a provider-supported field.
    const warnRoot = await fixture(files("  unsupportedDestination: warn"));
    const preview = await diffSkillsetResult(warnRoot);
    const marketplaceOutcomes = preview.renderResults.filter(
      (outcome) => outcome.featureId === "marketplaces"
    );
    expect(
      marketplaceOutcomes.flatMap((outcome) => outcome.diagnostics ?? [])
    ).toEqual([
      expect.objectContaining({
        code: "render/claude-marketplace-author-fields-omitted",
        message:
          "Claude marketplace entry drops canonical author fields: email",
        path: "marketplace.plugins.kept.author",
      }),
    ]);
    expect(
      marketplaceOutcomes.filter((outcome) => outcome.status === "lossy")
    ).toEqual([
      expect.objectContaining({
        sourceUnit: "plugin.kept.config:root",
        status: "lossy",
      }),
    ]);

    await buildSkillsetResult(warnRoot);
    const marketplace = await readJson(
      join(warnRoot, ".claude-plugin/marketplace.json")
    );
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ author: { name: "Kept Team" }, name: "kept" }),
    ]);

    const errorRoot = await fixture(files(""));
    await expect(
      buildSkillsetResult(errorRoot, { scopes: ["project"] })
    ).rejects.toThrow(
      "Claude marketplace entry drops canonical author fields: email"
    );
  });

  it("does not claim a plugin whose name an unrelated override entry reuses", async () => {
    // The override replaces the generated array with an entry that reuses the
    // local plugin's name but resolves to an unrelated remote source, so none
    // of the plugin's metadata reaches the marketplace.
    const files = (unsupportedDestination: string): Record<string, string> => ({
      "skillset.yaml": `
skillset:
  name: marketplace-override
  author:
    name: Root Team
compile:
  targets: [claude]
${unsupportedDestination}
claude:
  marketplace:
    plugins:
      - name: kept
        source:
          source: github
          repo: acme/unrelated
`,
      ".skillset/plugins/kept/skillset.yaml": `
skillset:
  name: kept
  author:
    name: Kept Team
    contributor: Kept Contributor
`,
      ".skillset/plugins/kept/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const warnRoot = await fixture(files("  unsupportedDestination: warn"));
    const preview = await diffSkillsetResult(warnRoot);
    expect(
      preview.renderResults
        .filter((outcome) => outcome.featureId === "marketplaces")
        .flatMap((outcome) => outcome.diagnostics ?? [])
    ).toEqual([]);

    // The plugin's extra canonical author field is absent from the
    // marketplace, so it must not block the build.
    await expect(
      buildSkillsetResult(await fixture(files("")), { scopes: ["project"] })
    ).resolves.toBeDefined();
  });

  it("validates conventional app JSON before claiming structured output", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: invalid-app
compile:
  targets: [codex]
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
`,
      ".skillset/plugins/tools/.app.json": `{"apps": [}`,
    });

    await expect(diffSkillsetResult(root)).rejects.toThrow(
      "invalid generated output"
    );
  });

  it("soft unsupported destination policies keep diagnostics and lock provenance visible", async () => {
    for (const policy of ["warn", "skip", "force"] as const) {
      const root = await fixture({
        ...OUTCOME_FIXTURE,
        "skillset.yaml": `
skillset:
  name: outcome-root
  marketplace:
    name: outcome-market
compile:
  unsupportedDestination: ${policy}
claude: true
codex: true
cursor: false
`,
        ".skillset/plugins/alpha/bin/tool": `
#!/usr/bin/env bash
echo alpha
`,
      });

      const result = await buildSkillsetResult(root);
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: `unsupported-destination-${policy}`,
          featureId: "plugin-bin",
          severity: "warning",
          sourceUnit: "plugin.alpha.feature:bin",
          target: "codex",
        })
      );
      expect(result.renderResults).toContainEqual(
        expect.objectContaining({
          destination: "bin",
          featureId: "plugin-bin",
          policy: `unsupported:${policy}`,
          reason: "Codex plugins do not expose a documented plugin-local bin contract.",
          sourceUnit: "plugin.alpha.feature:bin",
          status: "unsupported",
          target: "codex",
        })
      );

      const lock = await readJson(join(root, "skillset.lock"));
      expect(JSON.stringify(lock)).toContain(`"policy":"unsupported:${policy}"`);
      expect(JSON.stringify(lock)).toContain("Codex plugins do not expose a documented plugin-local bin contract.");

      const verify = await verifySkillsetResult(root);
      expect(verify.ok).toBe(true);
      expect(verify.diagnostics).toContainEqual(
        expect.objectContaining({
          code: `unsupported-destination-${policy}`,
          featureId: "plugin-bin",
          severity: "warning",
        })
      );
    }
  });

  it("soft unsupported destination policies reject provenance without usable output", async () => {
    for (const policy of ["warn", "skip", "force"] as const) {
      const root = await fixture({
        "skillset.yaml": `
skillset:
  name: soft-policy-lock-only
compile:
  unsupportedDestination: ${policy}
claude: false
codex: true
cursor: false
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
      const options = { scopes: ["project", "user"] as const };

      try {
        await buildSkillsetResult(root, options);
        throw new Error("expected buildSkillsetResult to reject provenance-only output");
      } catch (error) {
        expect(error).toBeInstanceOf(SkillsetRenderResultError);
        const failure = error as SkillsetRenderResultError;
        expect(failure.message).toContain(
          `unsupported destination policy ${policy} produced no usable target output`
        );
        expect(failure.message).toContain("at least one non-lock output must remain");
        expect(failure.renderResults).toContainEqual(
          expect.objectContaining({
            destination: "skill-frontmatter",
            featureId: "adaptive-hooks",
            policy: `unsupported:${policy}`,
            sourceUnit: "skill:writer",
            status: "unsupported",
            target: "codex",
          })
        );
      }
    }
  });

  it("enforces unsupported adaptive hook outcomes for Codex component scopes", async () => {
    const skillRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-skill
claude: false
codex: true
cursor: false
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
cursor: false
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
cursor: false
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
cursor: false
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
cursor: false
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
cursor: false
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

    const claudeMatcherRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-claude-matcher
claude: true
codex: false
cursor: false
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
    await expectUnsupportedOutcome(claudeMatcherRoot, {
      destination: "hooks",
      featureId: "adaptive-hooks",
      reason: "Claude ignores matchers for adaptive hook event Stop, so this attachment cannot render faithfully.",
      sourceUnit: "plugin.demo.feature:hooks",
      target: "claude",
    });
  });

  it("enforces unsupported adaptive hook outcomes for render field gaps", async () => {
    const providerOverrideRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-provider-override
claude: true
codex: false
cursor: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  SessionStart:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        claude: { context: { strategy: "none" } },
        events: ["SessionStart"],
        run: { command: "echo ok" },
      }),
    });
    const providerOverridePreview = await diffSkillsetResult(providerOverrideRoot);
    expect(providerOverridePreview.renderResults).not.toContainEqual(expect.objectContaining({
      featureId: "adaptive-hooks",
      status: "unsupported",
      target: "claude",
    }));

    const rawContextOverrideRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-raw-context-override
claude: true
codex: false
cursor: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  SessionStart:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        claude: { context: { includeRaw: false, strategy: "none" } },
        events: ["SessionStart"],
        run: { command: "echo ok" },
      }),
    });
    await expectUnsupportedOutcome(rawContextOverrideRoot, {
      destination: "hooks",
      featureId: "adaptive-hooks",
      reason: "Adaptive hook shell-policy sets context.includeRaw, but raw runtime context rendering is not implemented yet; remove context.includeRaw.",
      sourceUnit: "plugin.demo.feature:hooks",
      target: "claude",
    });

    const ambiguousHandlerOverrideRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-ambiguous-handler-override
claude: true
codex: false
cursor: false
`,
      ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
hooks:
  SessionStart:
    - shell-policy
`,
      ".skillset/plugins/demo/hooks/shell-policy.json": JSON.stringify({
        claude: {
          run: {
            command: "echo claude",
            script: "{{scripts.dir}}/claude.sh",
          },
        },
        events: ["SessionStart"],
        run: { command: "echo base" },
      }),
      ".skillset/plugins/demo/scripts/claude.sh": "#!/bin/sh\necho claude\n",
    });
    await expectUnsupportedOutcome(ambiguousHandlerOverrideRoot, {
      destination: "hooks",
      featureId: "adaptive-hooks",
      reason: "Adaptive hook shell-policy defines both run.command and run.script; choose exactly one handler before rendering.",
      sourceUnit: "plugin.demo.feature:hooks",
      target: "claude",
    });

    const runFieldRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-run-field
claude: false
codex: true
cursor: false
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
        run: { command: "echo ok", cwd: "scripts" },
      }),
    });
    await expectUnsupportedOutcome(runFieldRoot, {
      destination: "hooks",
      featureId: "adaptive-hooks",
      reason: "Adaptive hook shell-policy uses run.cwd, but plugin hook rendering only supports run.command, run.script, and run.env yet.",
      sourceUnit: "plugin.demo.feature:hooks",
    });

    const runtimePathRoot = await fixture({
      "skillset.yaml": `
skillset:
  name: adaptive-hook-policy-frontmatter-script
claude: true
codex: false
cursor: false
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
    // skill artifact and its tools-policy frontmatter scope under claude.
    const claudeSkillDestinations = preview.renderResults
      .filter(
        (result) =>
          result.sourceUnit === "plugin.alpha.skill:plugin-skill" && result.target === "claude"
      )
      .map((result) => result.destination)
      .sort();
    expect(claudeSkillDestinations).toContain("skill");
    expect(claudeSkillDestinations).toContain("skill-frontmatter");

    // The same skill under codex carries a distinct tools-policy destination,
    // proving destination varies by scope while target stays the provider.
    expect(preview.renderResults).toContainEqual(
      expect.objectContaining({
        destination: "skill-tools",
        featureId: "tools-policy",
        sourceUnit: "plugin.alpha.skill:plugin-skill",
        target: "codex",
      })
    );
  });

  it("tracks marketplace authors through a renamed Claude marketplace entry", async () => {
    const files = (unsupportedDestination: string): Record<string, string> => ({
      "skillset.yaml": `
skillset:
  name: marketplace-evidence
  author:
    name: Root Team
compile:
  targets: [claude]
${unsupportedDestination}
`,
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
  author:
    name: Plugin Team
    contributor: Plugin Contributor
claude:
  marketplace:
    name: tools-renamed
`,
      ".skillset/plugins/tools/skills/helper/SKILL.md": `
---
description: Help with repository tasks.
---

Help with the task.
`,
    });

    const warnRoot = await fixture(files("  unsupportedDestination: warn"));
    const preview = await diffSkillsetResult(warnRoot);
    const marketplaceOutcomes = preview.renderResults.filter(
      (outcome) => outcome.featureId === "marketplaces"
    );
    expect(
      marketplaceOutcomes.flatMap((outcome) => outcome.diagnostics ?? [])
    ).toEqual([
      expect.objectContaining({
        code: "render/claude-marketplace-author-fields-omitted",
        path: "marketplace.plugins.tools.author",
      }),
    ]);
    expect(
      marketplaceOutcomes.filter((outcome) => outcome.status === "lossy")
    ).toEqual([
      expect.objectContaining({
        sourceUnit: "plugin.tools.config:root",
        status: "lossy",
      }),
    ]);

    const built = await buildSkillsetResult(warnRoot);
    const marketplace = await readJson(
      join(warnRoot, ".claude-plugin/marketplace.json")
    );
    expect(built.writes.writtenPaths).toContain(
      ".claude-plugin/marketplace.json"
    );
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: "tools-renamed" }),
    ]);

    // A marketplace-scoped build excludes the plugin manifest, so the
    // marketplace render result is the only record of the omission.
    const errorRoot = await fixture(files(""));
    await expect(
      buildSkillsetResult(errorRoot, { scopes: ["project"] })
    ).rejects.toThrow(
      "Claude marketplace author output supports only name, email, and url; omitted canonical fields: contributor"
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

async function lockItemSourceHash(
  lockPath: string,
  kind: string
): Promise<string | undefined> {
  const lock = await readJson(lockPath);
  const item = (lock.items as Array<Record<string, unknown>>).find(
    (candidate) => candidate.kind === kind
  );
  return item?.sourceHash as string | undefined;
}

async function projectAgentSourceHash(root: string): Promise<string | undefined> {
  return lockItemSourceHash(join(root, "skillset.lock"), "project-agent");
}

async function skillSourceHash(root: string): Promise<string | undefined> {
  return lockItemSourceHash(join(root, ".claude/skills/skillset.lock"), "standalone-skill");
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
