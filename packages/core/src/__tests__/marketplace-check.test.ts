import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult } from "../build";
import { checkMarketplaces } from "../marketplace-check";
import { writeKnownSkillsetsIndex } from "../known-skillsets";

describe("marketplace check", () => {
  test("reports local generated and verified plugin targets as marketplace-ready", async () => {
    const root = await fixture(localMarketplaceFiles());
    await buildSkillsetResult(root);

    const report = await checkMarketplaces(root);

    expect(report.ok).toBe(true);
    expect(report.marketplaces).toEqual(["outfitter"]);
    expect(report.entries).toHaveLength(2);
    expect(report.entries).toContainEqual(expect.objectContaining({
      catalog: "outfitter",
      entryId: "local-tools",
      generatedPath: "plugins-claude/plugins/local-tools/.claude-plugin/plugin.json",
      plugin: "local-tools",
      providerSource: "./plugins/local-tools",
      readiness: "marketplace-ready",
      requestedTarget: "claude",
      resolvedTargetSupport: true,
      lock: expect.objectContaining({ state: "locked" }),
      states: ["declared", "resolved", "renderable", "generated", "verified", "locked", "marketplace-ready"],
    }));
    expect(report.entries).toContainEqual(expect.objectContaining({
      generatedPath: "plugins-codex/plugins/local-tools/.codex-plugin/plugin.json",
      requestedTarget: "codex",
    }));
  });

  test("blocks unbuilt and stale provider output", async () => {
    const unbuilt = await fixture(localMarketplaceFiles());

    const unbuiltReport = await checkMarketplaces(unbuilt, { name: "outfitter" });

    expect(unbuiltReport.ok).toBe(false);
    expect(unbuiltReport.entries[0]).toEqual(expect.objectContaining({
      readiness: "not-ready",
      reason: "missing generated file: plugins-claude/plugins/local-tools/.claude-plugin/plugin.json",
      resolvedTargetSupport: true,
    }));

    const stale = await fixture(localMarketplaceFiles());
    await buildSkillsetResult(stale);
    await writeFile(
      join(stale, "plugins-claude/plugins/local-tools/.claude-plugin/plugin.json"),
      "{ \"stale\": true }\n"
    );

    const staleReport = await checkMarketplaces(stale, { name: "outfitter" });

    expect(staleReport.ok).toBe(false);
    expect(staleReport.entries[0]).toEqual(expect.objectContaining({
      readiness: "not-ready",
      reason: "version drift: plugins-claude/plugins/local-tools/.claude-plugin/plugin.json version is missing, expected 0.1.0",
      resolvedTargetSupport: true,
    }));
  });

  test("blocks missing plugins and target-missing entries", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude, codex]
    plugins:
      - plugin: missing-tools
      - plugin: claude-only
        targets: [codex]
`,
      ".skillset/plugins/claude-only/skillset.yaml": `
skillset:
  name: claude-only
codex: false
`,
    });
    await buildSkillsetResult(root);

    const report = await checkMarketplaces(root);

    expect(report.ok).toBe(false);
    expect(report.entries).toContainEqual(expect.objectContaining({
      entryId: "missing-tools",
      plugin: "missing-tools",
      reason: "missing plugin missing-tools",
      requestedTarget: "claude",
      states: ["declared", "resolved", "locked", "not-ready"],
    }));
    expect(report.entries).toContainEqual(expect.objectContaining({
      entryId: "claude-only",
      plugin: "claude-only",
      reason: "codex output is not enabled for plugin claude-only",
      requestedTarget: "codex",
      states: ["declared", "resolved", "locked", "not-ready"],
    }));
  });

  test("resolves external plugin refs from the managed known-Skillsets index", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-marketplace-known-"));
    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - id: trails
        plugin: trails-tools
        repo: github:outfitter-dev/trails
`,
    }, root);
    const external = await fixture({
      "skillset.yaml": `
skillset:
  name: trails
`,
      ".skillset/plugins/trails-tools/skillset.yaml": `
skillset:
  name: trails-tools
`,
    }, root);
    await buildSkillsetResult(external);
    const xdg = xdgOptions(root);
    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "trails",
        identities: ["github:outfitter-dev/trails"],
        path: external,
        repository: "git@github.com:outfitter-dev/trails.git",
      }],
    }, xdg);

    const report = await checkMarketplaces(marketplace, { xdg });

    expect(report.ok).toBe(true);
    expect(report.entries).toEqual([expect.objectContaining({
      entryId: "trails",
      lock: expect.objectContaining({ state: "absent", policy: "local" }),
      plugin: "trails-tools",
      readiness: "marketplace-ready",
      repo: "github:outfitter-dev/trails",
      requestedTarget: "claude",
      source: expect.objectContaining({
        cacheKey: "trails",
        kind: "known-index",
        path: external,
        repository: "git@github.com:outfitter-dev/trails.git",
      }),
    })]);
  });

  test("keeps bare external repo entries as current-checkout policy in the marketplace lock", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - id: trails
        plugin: trails-tools
        repo: github:outfitter-dev/trails
`,
    });

    await buildSkillsetResult(root);
    const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8")) as {
      marketplaces: { entries: Array<{ requested: { kind: string; channel?: string } }> };
    };

    expect(lock.marketplaces.entries).toEqual([expect.objectContaining({
      requested: { kind: "local" },
    })]);
  });

  test("reports unresolved external plugin refs without remote writes", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: trails-tools
        repo: github:outfitter-dev/trails
`,
    });
    const before = await readdir(root);

    const report = await checkMarketplaces(root, { xdg: xdgOptions(root) });

    expect(report.ok).toBe(false);
    expect(report.entries).toEqual([expect.objectContaining({
      readiness: "not-ready",
      reason: "unresolved external repo",
      repo: "github:outfitter-dev/trails",
      source: { kind: "unresolved" },
      states: ["declared", "not-ready"],
    })]);
    await expect(readdir(root)).resolves.toEqual(before);
  });

  test("reports invalid known-index checkouts as not-ready entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-marketplace-invalid-known-"));
    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: trails-tools
        repo: github:outfitter-dev/trails
`,
    }, root);
    const invalid = await mkdtemp(join(root, "invalid-skillset-"));
    const xdg = xdgOptions(root);
    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "trails",
        identities: ["github:outfitter-dev/trails"],
        path: invalid,
      }],
    }, xdg);

    const report = await checkMarketplaces(marketplace, { xdg });

    expect(report.ok).toBe(false);
    expect(report.entries).toEqual([expect.objectContaining({
      readiness: "not-ready",
      reason: expect.stringContaining("failed to inspect source:"),
      source: expect.objectContaining({
        cacheKey: "trails",
        kind: "known-index",
        path: invalid,
      }),
      states: ["declared", "not-ready"],
    })]);
  });

  test("reports stale marketplace lock provenance", async () => {
    const root = await fixture(localMarketplaceFiles());
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      marketplaces: { entries: Array<{ generatedPaths: string[]; resolved: { generatedPaths: string[] } }> };
    };
    lock.marketplaces.entries[0]!.generatedPaths = ["plugins-claude/plugins/local-tools/stale.json"];
    lock.marketplaces.entries[0]!.resolved.generatedPaths = ["plugins-claude/plugins/local-tools/stale.json"];
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const report = await checkMarketplaces(root, { name: "outfitter" });

    expect(report.ok).toBe(false);
    expect(report.entries).toContainEqual(expect.objectContaining({
      lock: expect.objectContaining({
        reason: "marketplace lock entry is stale for the current resolution",
        state: "stale",
      }),
      readiness: "not-ready",
      requestedTarget: "claude",
      states: ["declared", "resolved", "renderable", "generated", "verified", "stale", "not-ready"],
    }));
  });

  test("blocks pinned marketplace entries when the source sha cannot be verified", async () => {
    const root = await fixture({
      ...localMarketplaceFiles(),
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: local-tools
        sha: deadbeef
`,
    });
    await buildSkillsetResult(root);

    const report = await checkMarketplaces(root, { name: "outfitter" });

    expect(report.ok).toBe(false);
    expect(report.entries).toEqual([expect.objectContaining({
      lock: expect.objectContaining({
        expectedSha: "deadbeef",
        policy: "sha",
        reason: "pinned sha deadbeef could not be verified for the resolved source",
        state: "stale",
      }),
      readiness: "not-ready",
      states: ["declared", "pinned", "resolved", "renderable", "generated", "verified", "stale", "not-ready"],
    })]);
  });
});

function localMarketplaceFiles(): Record<string, string> {
  return {
    "skillset.yaml": `
skillset:
  name: marketplace-root
compile:
  targets: [claude, codex]
marketplaces:
  outfitter:
    targets: [claude, codex]
    plugins:
      - plugin: local-tools
`,
    ".skillset/plugins/local-tools/skillset.yaml": `
skillset:
  name: local-tools
`,
    ".skillset/plugins/local-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
  };
}

async function fixture(files: Record<string, string>, parent?: string): Promise<string> {
  const root = await mkdtemp(join(parent ?? tmpdir(), "skillset-marketplace-check-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

function xdgOptions(root: string): { env: Record<string, string>; homeDir: string } {
  return {
    env: {
      XDG_CONFIG_HOME: join(root, "config"),
    },
    homeDir: join(root, "home"),
  };
}
