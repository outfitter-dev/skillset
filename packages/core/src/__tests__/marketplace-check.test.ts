import { chmod, mkdtemp, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { createTestGitRemote, runTestGit } from "../../../../scripts/test-helpers/git-remote";
import { buildSkillsetResult, verifySkillsetResult } from "../build";
import { storedClaudeMarketplaceProviderEntry } from "../claude-marketplace";
import { detectHostLeaks } from "../host-leak";
import {
  checkMarketplaces,
  listMarketplaceCatalogs,
} from "../marketplace-check";
import {
  normalizeMarketplaceUpdatePlanPath,
  updateMarketplaces,
} from "../marketplace-update";
import { writeKnownSkillsetsIndex } from "../known-skillsets";
import { resolveRemoteRepositoryCache } from "../remote-repository-cache";
import type { JsonRecord } from "../types";

describe("marketplace check", () => {
  test("SET-297: normalizes marketplace plan paths portably", () => {
    expect(
      normalizeMarketplaceUpdatePlanPath(
        "plugins\\demo\\claude\\.claude-plugin\\marketplace.json"
      )
    ).toBe("plugins/demo/claude/.claude-plugin/marketplace.json");
  });

  test("SET-297: lists configured catalogs without resolving external repositories", async () => {
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  zeta:
    targets: [claude]
    plugins:
      - plugin: remote-tools
        repo: https://git.invalid/acme/remote-tools.git
        sha: 0123456789abcdef0123456789abcdef01234567
  alpha:
    targets: [claude]
    plugins:
      - plugin: local-tools
`,
    });

    expect(await listMarketplaceCatalogs(root)).toEqual(["alpha", "zeta"]);
  });

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
      generatedPath: "plugins/local-tools/claude/.claude-plugin/plugin.json",
      plugin: "local-tools",
      providerSource: "./plugins/local-tools/claude",
      readiness: "marketplace-ready",
      requestedTarget: "claude",
      resolvedTargetSupport: true,
      lock: expect.objectContaining({ state: "locked" }),
      states: ["declared", "resolved", "renderable", "generated", "verified", "locked", "marketplace-ready"],
    }));
    expect(report.entries).toContainEqual(expect.objectContaining({
      generatedPath: "plugins/local-tools/codex/.codex-plugin/plugin.json",
      requestedTarget: "codex",
    }));
  });

  test("blocks unbuilt and stale provider output", async () => {
    const unbuilt = await fixture(localMarketplaceFiles());

    const unbuiltReport = await checkMarketplaces(unbuilt, { name: "outfitter" });

    expect(unbuiltReport.ok).toBe(false);
    expect(unbuiltReport.entries[0]).toEqual(expect.objectContaining({
      readiness: "not-ready",
      reason: "missing generated file: plugins/local-tools/claude/.claude-plugin/plugin.json",
      resolvedTargetSupport: true,
    }));

    const stale = await fixture(localMarketplaceFiles());
    await buildSkillsetResult(stale);
    await writeFile(
      join(stale, "plugins/local-tools/claude/.claude-plugin/plugin.json"),
      "{ \"stale\": true }\n"
    );

    const staleReport = await checkMarketplaces(stale, { name: "outfitter" });

    expect(staleReport.ok).toBe(false);
    expect(staleReport.entries[0]).toEqual(expect.objectContaining({
      readiness: "not-ready",
      reason: "version drift: plugins/local-tools/claude/.claude-plugin/plugin.json version is missing, expected 0.1.0",
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
    const gitRoot = await mkdtemp(join(root, "git-"));
    const remote = await createTestGitRemote(external, {
      repository: "https://github.com/outfitter-dev/trails.git",
      rootPath: gitRoot,
    });
    await runTestGit(external, "remote", "add", "origin", remote.repository);
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
        sha: ${remote.sha}
`,
    }, root);
    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "trails",
        identities: ["github:outfitter-dev/trails"],
        path: external,
        repository: remote.repository,
      }],
    }, remote.xdg);
    const trackedPath = join(external, ".skillset/plugins/trails-tools/skillset.yaml");
    const trackedStat = await stat(trackedPath);
    await utimes(trackedPath, trackedStat.atime, new Date(trackedStat.mtimeMs + 10_000));
    const indexPath = join(external, ".git/index");
    const indexBefore = await readFile(indexPath);

    const updated = await updateMarketplaces(marketplace, { name: "outfitter", write: true, xdg: remote.xdg });
    const report = await checkMarketplaces(marketplace, { xdg: remote.xdg });

    expect(updated.ok).toBe(true);
    expect(report.ok).toBe(true);
    expect((await readFile(indexPath)).equals(indexBefore)).toBe(true);
    expect(report.entries).toEqual([expect.objectContaining({
      entryId: "trails",
      lock: expect.objectContaining({ state: "locked", policy: "sha" }),
      plugin: "trails-tools",
      readiness: "marketplace-ready",
      repo: "github:outfitter-dev/trails",
      requestedTarget: "claude",
      source: expect.objectContaining({
        kind: "known-index",
        repository: "github:outfitter-dev/trails",
        sha: remote.sha,
      }),
    })]);
    const remoteOnlyXdg = {
      ...remote.xdg,
      env: {
        ...remote.xdg.env,
        XDG_CONFIG_HOME: join(root, "clean-config"),
      },
    };
    const remoteReport = await checkMarketplaces(marketplace, { xdg: remoteOnlyXdg });
    expect(remoteReport.ok).toBe(true);
    expect(remoteReport.entries[0]?.source.kind).toBe("remote-cache");
    expect(remoteReport.entries[0]?.provenance).toEqual(report.entries[0]?.provenance);

    await writeFile(join(external, ".skillset/plugins/trails-tools/skillset.yaml"), `
skillset:
  name: trails-tools
  version: 2.0.0
`.trimStart());
    await buildSkillsetResult(external);
    const dirtyReport = await checkMarketplaces(marketplace, { xdg: remote.xdg });
    expect(dirtyReport.ok).toBe(true);
    expect(dirtyReport.entries[0]?.source.kind).toBe("remote-cache");
    expect(dirtyReport.entries[0]?.provenance.resolved.pluginVersion).not.toBe("2.0.0");
  });

  test("defaults bare external repo entries to the latest channel policy", async () => {
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
      requested: { channel: "latest", kind: "channel" },
    })]);
  });

  test("reports unavailable external plugin refs without marketplace writes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-unavailable-"));
    const root = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: trails-tools
        repo: https://git.invalid/outfitter-dev/trails.git
        ref: main
`,
    }, parent);
    const xdg = unavailableXdg(parent, "https://git.invalid/outfitter-dev/trails.git");
    const before = await readdir(root);

    const report = await checkMarketplaces(root, { xdg });

    expect(report.ok).toBe(false);
    expect(report.entries).toEqual([expect.objectContaining({
      readiness: "not-ready",
      reason: "failed to inspect source: skillset: remote repository could not be reached",
      repo: "https://git.invalid/outfitter-dev/trails.git",
      source: { kind: "remote-cache", repository: "https://git.invalid/outfitter-dev/trails" },
      states: ["declared", "floating", "not-ready"],
    })]);
    await expect(readdir(root)).resolves.toEqual(before);
  });

  test("ignores invalid known-index checkouts and falls through to remote resolution", async () => {
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
        repo: https://git.invalid/outfitter-dev/trails.git
        sha: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`,
    }, root);
    const invalid = await mkdtemp(join(root, "invalid-skillset-"));
    const xdg = unavailableXdg(root, "https://git.invalid/outfitter-dev/trails.git");
    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "trails",
        identities: ["https://git.invalid/outfitter-dev/trails.git"],
        path: invalid,
      }],
    }, xdg);

    const report = await checkMarketplaces(marketplace, { xdg });

    expect(report.ok).toBe(false);
    expect(report.entries).toEqual([expect.objectContaining({
      readiness: "not-ready",
      reason: "failed to inspect source: skillset: remote acquisition failed for https://git.invalid/outfitter-dev/trails during fetch",
      source: {
        kind: "remote-cache",
        repository: "https://git.invalid/outfitter-dev/trails",
      },
      states: ["declared", "pinned", "stale", "not-ready"],
    })]);
  });

  test("reports stale marketplace lock provenance", async () => {
    const root = await fixture(localMarketplaceFiles());
    await buildSkillsetResult(root);
    const lockPath = join(root, "skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      marketplaces: { entries: Array<{ generatedPaths: string[]; resolved: { generatedPaths: string[] } }> };
    };
    lock.marketplaces.entries[0]!.generatedPaths = ["plugins/local-tools/claude/stale.json"];
    lock.marketplaces.entries[0]!.resolved.generatedPaths = ["plugins/local-tools/claude/stale.json"];
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
        sha: dddddddddddddddddddddddddddddddddddddddd
`,
    });
    await buildSkillsetResult(root);

    const report = await checkMarketplaces(root, { name: "outfitter" });

    expect(report.ok).toBe(false);
    expect(report.entries).toEqual([expect.objectContaining({
      lock: expect.objectContaining({
        expectedSha: "dddddddddddddddddddddddddddddddddddddddd",
        policy: "sha",
        reason: "pinned sha dddddddddddddddddddddddddddddddddddddddd could not be verified for the resolved source",
        state: "stale",
      }),
      readiness: "not-ready",
      states: ["declared", "pinned", "resolved", "renderable", "generated", "verified", "stale", "not-ready"],
    })]);
  });

  test("SET-268: resolves remote refs through XDG with portable check, update, and lock provenance", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-remote-"));
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
        repo: https://git.example/acme/trails.git
        ref: main
`,
    }, parent);
    const external = await fixture({
      "skillset.yaml": `
skillset:
  name: trails
`,
      ".skillset/plugins/trails-tools/skillset.yaml": `
skillset:
  name: trails-tools
  version: 1.2.3
`,
      ".skillset/plugins/trails-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
    }, parent);
    await buildSkillsetResult(external);
    const gitRoot = await mkdtemp(join(parent, "git-"));
    const remote = await createTestGitRemote(external, {
      repository: "https://git.example/acme/trails.git",
      rootPath: gitRoot,
    });

    const updated = await updateMarketplaces(marketplace, {
      name: "outfitter",
      write: true,
      xdg: remote.xdg,
    });

    expect(updated.ok).toBe(true);
    expect(updated.writtenPaths).toEqual([".claude-plugin/marketplace.json", "skillset.lock"]);
    expect(updated.check.entries).toEqual([expect.objectContaining({
      readiness: "marketplace-ready",
      source: {
        kind: "remote-cache",
        ref: "main",
        repository: "https://git.example/acme/trails",
        sha: remote.sha,
      },
      provenance: expect.objectContaining({
        resolved: expect.objectContaining({
          repository: "https://git.example/acme/trails",
          sha: remote.sha,
          sourceKind: "external",
        }),
      }),
    })]);

    const lockText = await readFile(join(marketplace, "skillset.lock"), "utf8");
    const indexText = await readFile(join(marketplace, ".claude-plugin/marketplace.json"), "utf8");
    const reportText = JSON.stringify(updated.check);
    for (const [path, content] of [
      ["skillset.lock", lockText],
      [".claude-plugin/marketplace.json", indexText],
      ["marketplace-report.json", reportText],
    ] as const) {
      expect(detectHostLeaks(path, content, {
        forbiddenSubstrings: [parent, external, remote.remotePath, remote.xdg.homeDir],
      })).toEqual([]);
      expect(content).not.toContain("sourcePath");
      expect(content).not.toContain("cacheKey");
    }
    expect(JSON.parse(indexText)).toEqual(expect.objectContaining({
      plugins: [expect.objectContaining({
        source: expect.objectContaining({ ref: "main", sha: remote.sha }),
      })],
    }));

    const checked = await checkMarketplaces(marketplace, { name: "outfitter", xdg: remote.xdg });
    const verified = await verifySkillsetResult(marketplace, { xdg: remote.xdg });
    expect(checked.ok).toBe(true);
    expect(checked.entries[0]?.provenance).toEqual(updated.check.entries[0]?.provenance);
    expect(verified.data.failures).toEqual([]);
    await chmod(join(marketplace, "skillset.lock"), 0o444);
    expect((await updateMarketplaces(marketplace, {
      name: "outfitter",
      write: true,
      xdg: remote.xdg,
    })).ok).toBe(true);
    expect((await verifySkillsetResult(marketplace, { xdg: remote.xdg })).data.failures).toEqual([]);

    const tamperedLock = JSON.parse(lockText) as {
      marketplaces: { entries: Array<JsonRecord & { providerEntry?: JsonRecord }> };
    };
    const storedEntry = tamperedLock.marketplaces.entries[0];
    expect(storedEntry).toBeDefined();
    expect(storedClaudeMarketplaceProviderEntry(storedEntry ?? {})).toBeDefined();
    const malformedEntry = structuredClone(storedEntry ?? {});
    if (
      malformedEntry.providerEntry !== undefined &&
      typeof malformedEntry.providerEntry.source === "object" &&
      malformedEntry.providerEntry.source !== null &&
      !Array.isArray(malformedEntry.providerEntry.source)
    ) {
      malformedEntry.providerEntry = {
        ...malformedEntry.providerEntry,
        source: {
          ...(malformedEntry.providerEntry.source as JsonRecord),
          sha: "b".repeat(40),
        },
      };
    }
    expect(storedClaudeMarketplaceProviderEntry(malformedEntry)).toBeUndefined();
    if (storedEntry !== undefined) delete storedEntry.providerEntry;
    const tamperedIndex = JSON.parse(indexText) as { plugins: unknown[] };
    tamperedIndex.plugins = [];
    await writeFile(join(marketplace, "skillset.lock"), `${JSON.stringify(tamperedLock, null, 2)}\n`);
    await writeFile(
      join(marketplace, ".claude-plugin/marketplace.json"),
      `${JSON.stringify(tamperedIndex, null, 2)}\n`
    );

    const tamperedCheck = await checkMarketplaces(marketplace, { name: "outfitter", xdg: remote.xdg });
    const tamperedVerify = await verifySkillsetResult(marketplace, { xdg: remote.xdg });
    expect(tamperedCheck.ok).toBe(false);
    expect(tamperedCheck.entries[0]?.lock.state).toBe("absent");
    expect(tamperedVerify.data.failures).toContain("stale generated file: skillset.lock");
  });

  test("SET-297: a confirmed update refuses a floating ref that changed after preview", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-confirmed-plan-"));
    const repository = "https://git.example/acme/confirmed-plan.git";
    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: remote-tools
        repo: ${repository}
        ref: main
`,
    }, parent);
    const external = await fixture({
      "skillset.yaml": "skillset:\n  name: confirmed-plan\n",
      ".skillset/plugins/remote-tools/skillset.yaml": `
skillset:
  name: remote-tools
  version: 1.0.0
`,
    }, parent);
    await buildSkillsetResult(external);
    const gitRoot = await mkdtemp(join(parent, "git-"));
    const remote = await createTestGitRemote(external, {
      repository,
      rootPath: gitRoot,
    });

    const preview = await updateMarketplaces(marketplace, {
      name: "outfitter",
      xdg: remote.xdg,
    });
    if (preview.planHash === undefined) {
      throw new Error("expected marketplace preview plan hash");
    }

    await writeFile(
      join(external, ".skillset/plugins/remote-tools/skillset.yaml"),
      "skillset:\n  name: remote-tools\n  version: 2.0.0\n"
    );
    await buildSkillsetResult(external);
    await runTestGit(external, "add", "--all");
    await runTestGit(external, "commit", "-m", "advance floating marketplace ref");
    await runTestGit(external, "push", remote.remotePath, "main");
    const advancedSha = await runTestGit(external, "rev-parse", "HEAD");

    const applied = await updateMarketplaces(marketplace, {
      expectedPlanHash: preview.planHash,
      name: "outfitter",
      write: true,
      xdg: remote.xdg,
    });

    expect(applied.ok).toBe(false);
    expect(applied.reason).toBe(
      "marketplace update changed after preview; review the latest plan before writing"
    );
    expect(applied.planHash).not.toBe(preview.planHash);
    expect(applied.check.entries[0]?.source.sha).toBe(advancedSha);
    expect(applied.writtenPaths).toEqual([]);
    expect(await Bun.file(join(marketplace, ".claude-plugin/marketplace.json")).exists()).toBe(false);
    expect(await Bun.file(join(marketplace, "skillset.lock")).exists()).toBe(false);
  }, 15_000);

  test("SET-297: invalid apply-time resolution preserves prior marketplace bytes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-invalid-apply-"));
    const repository = "https://git.example/acme/invalid-apply.git";
    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: remote-tools
        repo: ${repository}
        ref: main
`,
    }, parent);
    const external = await fixture({
      "skillset.yaml": "skillset:\n  name: invalid-apply\n",
      ".skillset/plugins/remote-tools/skillset.yaml": `
skillset:
  name: remote-tools
  version: 1.0.0
`,
    }, parent);
    await buildSkillsetResult(external);
    const gitRoot = await mkdtemp(join(parent, "git-"));
    const remote = await createTestGitRemote(external, {
      repository,
      rootPath: gitRoot,
    });
    expect((await updateMarketplaces(marketplace, {
      name: "outfitter",
      write: true,
      xdg: remote.xdg,
    })).ok).toBe(true);
    const preview = await updateMarketplaces(marketplace, {
      name: "outfitter",
      xdg: remote.xdg,
    });
    if (preview.planHash === undefined) {
      throw new Error("expected marketplace preview plan hash");
    }
    const indexPath = join(marketplace, ".claude-plugin/marketplace.json");
    const lockPath = join(marketplace, "skillset.lock");
    const beforeIndex = await readFile(indexPath);
    const beforeLock = await readFile(lockPath);

    await writeFile(
      join(external, ".skillset/plugins/remote-tools/skillset.yaml"),
      "skillset:\n  name: remote-tools\n  version: 2.0.0\n"
    );
    await runTestGit(external, "add", "--all");
    await runTestGit(external, "commit", "-m", "invalidate floating marketplace output");
    await runTestGit(external, "push", remote.remotePath, "main");

    const applied = await updateMarketplaces(marketplace, {
      expectedPlanHash: preview.planHash,
      name: "outfitter",
      write: true,
      xdg: remote.xdg,
    });

    expect(applied.ok).toBe(false);
    expect(applied.reason).toBe(
      "marketplace update changed after preview; review the latest plan before writing"
    );
    expect(applied.check.entries[0]?.reason).toContain("version drift");
    expect(applied.planHash).toBeUndefined();
    expect(applied.writtenPaths).toEqual([]);
    expect(await readFile(indexPath)).toEqual(beforeIndex);
    expect(await readFile(lockPath)).toEqual(beforeLock);
  }, 15_000);

  test("SET-268: sequential named catalog updates preserve the active offline marketplace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-catalog-selection-"));
    const repository = "https://git.example/acme/catalog-plugins.git";
    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  alpha:
    targets: [claude]
    plugins:
      - plugin: local-a
      - plugin: remote-a
        repo: ${repository}
        ref: main
  beta:
    targets: [claude]
    plugins:
      - plugin: local-b
      - plugin: remote-b
        repo: ${repository}
        ref: main
`,
      ".skillset/plugins/local-a/skillset.yaml": "skillset:\n  name: local-a\n",
      ".skillset/plugins/local-b/skillset.yaml": "skillset:\n  name: local-b\n",
    }, parent);
    const external = await fixture({
      "skillset.yaml": "skillset:\n  name: catalog-plugins\n",
      ".skillset/plugins/remote-a/skillset.yaml": "skillset:\n  name: remote-a\n",
      ".skillset/plugins/remote-b/skillset.yaml": "skillset:\n  name: remote-b\n",
    }, parent);
    await buildSkillsetResult(marketplace);
    await buildSkillsetResult(external);
    const gitRoot = await mkdtemp(join(parent, "git-"));
    const remote = await createTestGitRemote(external, { repository, rootPath: gitRoot });

    expect((await updateMarketplaces(marketplace, {
      name: "alpha",
      write: true,
      xdg: remote.xdg,
    })).ok).toBe(true);
    expect((await verifySkillsetResult(marketplace, { xdg: remote.xdg })).data.failures).toEqual([]);

    expect((await updateMarketplaces(marketplace, {
      name: "beta",
      write: true,
      xdg: remote.xdg,
    })).ok).toBe(true);
    expect((await verifySkillsetResult(marketplace, { xdg: remote.xdg })).data.failures).toEqual([]);
    const index = JSON.parse(
      await readFile(join(marketplace, ".claude-plugin/marketplace.json"), "utf8")
    ) as { plugins: Array<{ name: string }> };
    const lock = JSON.parse(await readFile(join(marketplace, "skillset.lock"), "utf8")) as {
      marketplaces: { activeCatalogs: { claude: string } };
    };
    expect(index.plugins.map(({ name }) => name)).toEqual(["local-b", "remote-b"]);
    expect(lock.marketplaces.activeCatalogs).toEqual({ claude: "beta" });
  }, 15_000);

  test("SET-268: acquisition failure leaves every marketplace output untouched", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-remote-failure-"));
    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - id: valid
        plugin: trails-tools
        repo: https://git.example/acme/trails.git
        ref: main
      - id: missing
        plugin: missing-tools
        repo: https://git.invalid/acme/missing.git
        ref: main
`,
    }, parent);
    const external = await fixture({
      "skillset.yaml": "skillset:\n  name: trails\n",
      ".skillset/plugins/trails-tools/skillset.yaml": "skillset:\n  name: trails-tools\n",
    }, parent);
    await buildSkillsetResult(external);
    const gitRoot = await mkdtemp(join(parent, "git-"));
    const remote = await createTestGitRemote(external, {
      repository: "https://git.example/acme/trails.git",
      rootPath: gitRoot,
    });
    const before = await readdir(marketplace);

    const updated = await updateMarketplaces(marketplace, {
      name: "outfitter",
      write: true,
      xdg: remote.xdg,
    });

    expect(updated.ok).toBe(false);
    expect(updated.files).toEqual([]);
    expect(updated.writtenPaths).toEqual([]);
    expect(updated.check.entries).toContainEqual(expect.objectContaining({
      entryId: "missing",
      readiness: "not-ready",
      reason: "failed to inspect source: skillset: remote repository could not be reached",
      source: {
        kind: "remote-cache",
        repository: "https://git.invalid/acme/missing",
      },
    }));
    await expect(readdir(marketplace)).resolves.toEqual(before);
  });

  test("SET-268: resolves two revisions from the same repository independently", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-revisions-"));
    const external = await fixture({
      "skillset.yaml": "skillset:\n  name: revisions\n",
      ".skillset/plugins/revision-tools/skillset.yaml": `
skillset:
  name: revision-tools
  version: 1.0.0
`,
      ".skillset/plugins/revision-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

First revision.
`,
    }, parent);
    await buildSkillsetResult(external);
    const gitRoot = await mkdtemp(join(parent, "git-"));
    const remote = await createTestGitRemote(external, {
      repository: "https://git.example/acme/revisions.git",
      rootPath: gitRoot,
    });
    const firstSha = remote.sha;

    await writeFile(join(external, ".skillset/plugins/revision-tools/skillset.yaml"), `
skillset:
  name: revision-tools
  version: 2.0.0
`.trimStart());
    await buildSkillsetResult(external);
    await runTestGit(external, "add", "--all");
    await runTestGit(external, "commit", "-m", "second fixture revision");
    const secondSha = await runTestGit(external, "rev-parse", "HEAD");
    await runTestGit(external, "push", remote.remotePath, "main");

    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - id: revision-one
        plugin: revision-tools
        repo: ${remote.repository}
        sha: ${firstSha}
      - id: revision-two
        plugin: revision-tools
        repo: ${remote.repository}
        sha: ${secondSha}
`,
    }, parent);

    const report = await checkMarketplaces(marketplace, {
      lockMode: "refresh",
      name: "outfitter",
      xdg: remote.xdg,
    });

    expect(report.ok).toBe(true);
    expect(report.entries.map((entry) => [entry.entryId, entry.source.sha, entry.provenance.resolved.pluginVersion])).toEqual([
      ["revision-one", firstSha, "1.0.0"],
      ["revision-two", secondSha, "2.0.0"],
    ]);
  });

  test("SET-268: blocks stale generated output acquired from a remote ref", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-stale-remote-"));
    const external = await fixture({
      "skillset.yaml": "skillset:\n  name: stale-remote\n",
      ".skillset/plugins/stale-tools/skillset.yaml": `
skillset:
  name: stale-tools
  version: 1.0.0
`,
    }, parent);
    await buildSkillsetResult(external);
    const gitRoot = await mkdtemp(join(parent, "git-"));
    const remote = await createTestGitRemote(external, {
      repository: "https://git.example/acme/stale.git",
      rootPath: gitRoot,
    });
    await writeFile(join(external, ".skillset/plugins/stale-tools/skillset.yaml"), `
skillset:
  name: stale-tools
  version: 2.0.0
`.trimStart());
    await runTestGit(external, "add", "--all");
    await runTestGit(external, "commit", "-m", "stale source without generated output");
    await runTestGit(external, "push", remote.remotePath, "main");
    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: stale-tools
        repo: ${remote.repository}
        ref: main
`,
    }, parent);

    const updated = await updateMarketplaces(marketplace, {
      name: "outfitter",
      write: true,
      xdg: remote.xdg,
    });

    expect(updated.ok).toBe(false);
    expect(updated.writtenPaths).toEqual([]);
    expect(updated.check.entries[0]).toEqual(expect.objectContaining({
      readiness: "not-ready",
      reason: "version drift: plugins/stale-tools/claude/.claude-plugin/plugin.json version is 1.0.0, expected 2.0.0",
    }));
  });

  test("SET-268: reports a wrong-origin cache without repairing or exposing its path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-wrong-origin-"));
    const external = await fixture({
      "skillset.yaml": "skillset:\n  name: wrong-origin\n",
      ".skillset/plugins/origin-tools/skillset.yaml": "skillset:\n  name: origin-tools\n",
    }, parent);
    await buildSkillsetResult(external);
    const gitRoot = await mkdtemp(join(parent, "git-"));
    const remote = await createTestGitRemote(external, {
      repository: "https://git.example/acme/origin.git",
      rootPath: gitRoot,
    });
    const marketplace = await fixture({
      "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: origin-tools
        repo: ${remote.repository}
        ref: main
`,
    }, parent);
    expect((await updateMarketplaces(marketplace, { name: "outfitter", xdg: remote.xdg })).ok).toBe(true);
    const cache = resolveRemoteRepositoryCache(remote.repository, { kind: "ref", ref: "main" }, remote.xdg);
    await runTestGit(cache.path, "remote", "set-url", "origin", "https://git.example/other/repo.git");

    const updated = await updateMarketplaces(marketplace, {
      name: "outfitter",
      write: true,
      xdg: remote.xdg,
    });

    expect(updated.ok).toBe(false);
    expect(updated.writtenPaths).toEqual([]);
    expect(updated.check.entries[0]?.reason).toBe(
      "failed to inspect source: skillset: remote cache origin does not match the requested repository"
    );
    expect(JSON.stringify(updated.check)).not.toContain(cache.path);
    expect(JSON.stringify(updated.check)).not.toContain(cache.cacheKey);
    expect(await runTestGit(cache.path, "config", "--get", "remote.origin.url")).toBe(
      "https://git.example/other/repo.git"
    );
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

function unavailableXdg(
  root: string,
  repository: string
): { env: Record<string, string>; homeDir: string } {
  return {
    env: {
      GIT_ALLOW_PROTOCOL: "file",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.file://${join(root, "missing.git")}/.insteadOf`,
      GIT_CONFIG_VALUE_0: repository,
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_CONFIG_HOME: join(root, "config"),
    },
    homeDir: join(root, "home"),
  };
}
