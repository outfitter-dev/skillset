import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { explainPath } from "../authoring";
import { buildSkillsetResult, verifySkillsetResult } from "../build";
import { withLockProvenance } from "../lock-provenance";
import { updateMarketplaces } from "../marketplace-update";
import type { JsonRecord } from "../types";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";

const ROOT_CONFIG = `
skillset:
  name: catalog-root
claude: true
codex: false
cursor: true
`;

describe("SET-693: builds own provider marketplace catalogs", () => {
  test("lock-records the implicit Claude and Cursor catalogs", async () => {
    const root = await fixture({ "skillset.yaml": ROOT_CONFIG });
    await buildSkillsetResult(root);

    const lock = JSON.parse(await readFile(join(root, "skillset.lock"), "utf8")) as {
      readonly items: readonly Record<string, unknown>[];
    };
    for (const [target, path] of [
      ["claude", ".claude-plugin/marketplace.json"],
      ["cursor", ".cursor-plugin/marketplace.json"],
    ] as const) {
      expect(lock.items).toContainEqual(expect.objectContaining({
        feature: "marketplaces",
        files: [path],
        kind: "plugin-feature",
        name: `${target}-marketplace`,
        outputPath: path,
        owner: { target },
      }));
      const explained = await explainPath(root, path);
      expect(explained.kind).toBe("generated");
      expect(explained.notes).not.toContainEqual(expect.stringContaining("No lock entry"));
    }
  });

  test("switching from the implicit catalog to a declared one rebuilds without a collision", async () => {
    const root = await fixture({ "skillset.yaml": ROOT_CONFIG });
    await buildSkillsetResult(root);

    await writeFile(join(root, "skillset.yaml"), `${ROOT_CONFIG.trim()}
marketplaces:
  team:
    description: Team plugins.
    targets: [claude, cursor]
    plugins:
      - plugin: tools
`);
    const rebuilt = await buildSkillsetResult(root);

    expect(rebuilt.ok).toBe(true);
    expect(rebuilt.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unmanaged-output-collision" })
    );
    const catalog = JSON.parse(
      await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8")
    ) as { readonly name: string };
    expect(catalog.name).toBe("team");
  });
});

describe("SET-694: marketplace update and build agree on the lock", () => {
  test("a confirmed update leaves outputs current and records the build's local provenance", async () => {
    const parent = await createTestGitFixtureRoot("skillset-catalog-update-");
    const root = await fixture({
      "skillset.yaml": `${ROOT_CONFIG.trim()}
marketplaces:
  team:
    targets: [claude]
    plugins:
      - plugin: tools
`,
    }, parent);
    // On a branch, update's own resolution sees a ref; the lock must not keep it.
    await initializeTestGitRepository(root, { disposableRoot: parent });
    await buildSkillsetResult(root);
    const built = await readFile(join(root, "skillset.lock"), "utf8");

    const updated = await updateMarketplaces(root, { write: true });

    expect(updated.ok).toBe(true);
    expect(updated.writtenPaths).toEqual([".claude-plugin/marketplace.json", "skillset.lock"]);
    expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe(built);
    expect((await verifySkillsetResult(root)).ok).toBe(true);
    const lock = JSON.parse(built) as {
      readonly marketplaces: { readonly entries: readonly { readonly resolved: Record<string, unknown> }[] };
    };
    expect(lock.marketplaces.entries).toEqual([
      expect.objectContaining({ resolved: expect.not.objectContaining({ ref: expect.anything() }) }),
    ]);
  });
});

describe("SET-764: the lock is independent of the checkout's branch and HEAD", () => {
  const MARKETPLACE_CONFIG = `${ROOT_CONFIG.trim()}
marketplaces:
  team:
    targets: [claude, cursor]
    plugins:
      - plugin: tools
`;

  test("two branches with the same source write byte-identical locks", async () => {
    const parent = await createTestGitFixtureRoot("skillset-catalog-branch-");
    const root = await fixture({ "skillset.yaml": MARKETPLACE_CONFIG }, parent);
    await initializeTestGitRepository(root, { disposableRoot: parent });
    await buildSkillsetResult(root);
    expect((await updateMarketplaces(root, { write: true })).ok).toBe(true);
    await runTestGit(root, "add", "--all");
    await runTestGit(root, "commit", "-m", "generated");
    const onMain = await readFile(join(root, "skillset.lock"), "utf8");

    // A different branch name and a different HEAD, with unchanged source.
    await runTestGit(root, "checkout", "-b", "feature/restacked");
    await runTestGit(root, "commit", "--allow-empty", "-m", "advance HEAD");
    expect((await updateMarketplaces(root, { write: true })).ok).toBe(true);
    expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe(onMain);
    await buildSkillsetResult(root);
    expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe(onMain);
    expect((await verifySkillsetResult(root)).ok).toBe(true);

    const lock = JSON.parse(onMain) as {
      readonly marketplaces: { readonly entries: readonly { readonly resolved: Record<string, unknown> }[] };
    };
    expect(lock.marketplaces.entries.length).toBeGreaterThan(0);
    for (const entry of lock.marketplaces.entries) {
      expect(entry.resolved).toMatchObject({ sourceKind: "current" });
      expect(entry.resolved).not.toHaveProperty("ref");
      expect(entry.resolved).not.toHaveProperty("sha");
    }
  });

  test("a lock that recorded checkout ref and sha on local entries is rewritten without them", async () => {
    const parent = await createTestGitFixtureRoot("skillset-catalog-legacy-");
    const root = await fixture({ "skillset.yaml": MARKETPLACE_CONFIG }, parent);
    await initializeTestGitRepository(root, { disposableRoot: parent });
    await buildSkillsetResult(root);
    const current = await readFile(join(root, "skillset.lock"), "utf8");

    // Earlier releases wrote the checkout identity into local entries.
    const legacy = JSON.parse(current) as Record<string, unknown> & {
      readonly marketplaces: { readonly entries: { resolved: Record<string, unknown> }[] };
    };
    for (const entry of legacy.marketplaces.entries) {
      entry.resolved = {
        ...entry.resolved,
        ref: "feature/old-branch",
        sha: "0123456789abcdef0123456789abcdef01234567",
      };
    }
    await writeFile(
      join(root, "skillset.lock"),
      `${JSON.stringify(withLockProvenance(legacy as JsonRecord), null, 2)}\n`
    );

    expect((await verifySkillsetResult(root)).ok).toBe(false);
    await buildSkillsetResult(root);
    expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe(current);
    expect((await verifySkillsetResult(root)).ok).toBe(true);
  });
});

async function fixture(files: Record<string, string>, parent?: string): Promise<string> {
  const root = parent === undefined
    ? await createTestFixtureRoot("skillset-catalog-ownership-")
    : await mkdtemp(join(parent, "skillset-catalog-ownership-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles({
    ...files,
    ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
`,
    ".skillset/plugins/tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
  }))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}
