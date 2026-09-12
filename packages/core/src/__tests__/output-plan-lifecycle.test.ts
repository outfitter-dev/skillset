/* eslint-disable func-style, no-use-before-define, unicorn/import-style -- Lifecycle fixtures stay below the behavior they exercise. */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillsetResult, scopedOutputRoots } from "../build";
import { withLockProvenance } from "../lock-provenance";
import { resolveRepoOperationalCachePath } from "../operational-cache";
import {
  readManagedOutputState,
  type ManagedOutputProvenancePolicy,
} from "../output-safety";
import { loadBuildGraph } from "../resolver";

const SKILL = `---
name: review
description: Review changes.
---

Review the change.
`;

type SeedConsumer =
  | { readonly phase: "baseline"; readonly standardProfile: "agent-skills" }
  | { readonly phase: "delta"; readonly target: "codex" };

describe("coalesced output lifecycle", () => {
  test("retains a shared path when the provider remains after its standard owner is disabled", async () => {
    const root = await fixture(defaultCodexConfig());
    await seedManagedStandardRoot(root, [
      { phase: "baseline", standardProfile: "agent-skills" },
      { phase: "delta", target: "codex" },
    ]);

    const result = await buildSkillsetResult(root, { scopes: ["repo"] });

    expect(result.ok).toBe(true);
    expect(result.writes.deletedPaths).not.toContain(
      ".agents/skills/review/SKILL.md"
    );
    expect(
      await readFile(join(root, ".agents/skills/review/SKILL.md"), "utf-8")
    ).toContain("Review the change.");
  });

  test("discovers and removes an inactive standard root in its original scope", async () => {
    const root = await fixture(customCodexConfig());
    await seedManagedStandardRoot(root, [
      { phase: "baseline", standardProfile: "agent-skills" },
    ]);
    const graph = await loadBuildGraph(root);

    expect(graph.outputRoots).toContain(".agents/skills");
    expect(scopedOutputRoots(graph, ["repo"])).toContain(".agents/skills");
    expect(scopedOutputRoots(graph, ["project"])).not.toContain(
      ".agents/skills"
    );

    const result = await buildSkillsetResult(root, { scopes: ["repo"] });

    expect(result.ok).toBe(true);
    expect(result.writes.deletedPaths).toEqual(
      expect.arrayContaining([
        ".agents/skills/review/SKILL.md",
        ".agents/skills/skillset.lock",
      ])
    );
    expect(
      await Bun.file(join(root, ".agents/skills/review/SKILL.md")).exists()
    ).toBe(false);
    expect(
      await Bun.file(
        join(root, "generated/codex-skills/review/SKILL.md")
      ).exists()
    ).toBe(true);
  });

  test("rolls back an inactive-root transition atomically", async () => {
    const root = await fixture(customCodexConfig());
    await seedManagedStandardRoot(root, [
      { phase: "baseline", standardProfile: "agent-skills" },
    ]);

    await expect(
      buildSkillsetResult(
        root,
        { scopes: ["repo"] },
        {
          transactionOptions: {
            testHooks: {
              beforeApply: (operation) => {
                if (operation.kind === "delete") {
                  throw new Error("injected inactive-root cleanup failure");
                }
              },
            },
          },
        }
      )
    ).rejects.toThrow("injected inactive-root cleanup failure");

    expect(
      await readFile(join(root, ".agents/skills/review/SKILL.md"), "utf-8")
    ).toBe("previous standard output\n");
    expect(
      await Bun.file(join(root, ".agents/skills/skillset.lock")).exists()
    ).toBe(true);
    expect(
      await Bun.file(
        join(root, "generated/codex-skills/review/SKILL.md")
      ).exists()
    ).toBe(false);
  });

  test("applies inactive-root cleanup only inside an isolated projection", async () => {
    const root = await fixture(customCodexConfig());
    const xdg = {
      env: { XDG_CACHE_HOME: join(root, "xdg-cache") },
      homeDir: root,
    };
    const cacheRoot = resolveRepoOperationalCachePath(root, xdg);
    await seedManagedStandardRoot(
      cacheRoot,
      [{ phase: "baseline", standardProfile: "agent-skills" }],
      "latest"
    );
    await Bun.write(
      join(cacheRoot, "latest/.agents/skills/unmanaged.txt"),
      "keep me\n"
    );

    const result = await buildSkillsetResult(root, {
      isolated: true,
      scopes: ["repo"],
      xdg,
    });

    expect(result.ok).toBe(true);
    expect(result.writes.deletedPaths).toContain(
      ".skillset/cache/latest/.agents/skills/review/SKILL.md"
    );
    expect(
      await Bun.file(
        join(cacheRoot, "latest/.agents/skills/review/SKILL.md")
      ).exists()
    ).toBe(false);
    expect(
      await Bun.file(
        join(cacheRoot, "latest/generated/codex-skills/review/SKILL.md")
      ).exists()
    ).toBe(true);
    expect(
      await readFile(
        join(cacheRoot, "latest/.agents/skills/unmanaged.txt"),
        "utf-8"
      )
    ).toBe("keep me\n");
    expect(await Bun.file(join(root, ".agents/skills")).exists()).toBe(false);
  });

  test("rejects a future-schema inactive lock without granting cleanup ownership", async () => {
    const root = await fixture(customCodexConfig());
    await seedManagedStandardRoot(root, [
      { phase: "baseline", standardProfile: "agent-skills" },
    ]);
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf-8"));
    lock.schemaVersion = 4;
    await Bun.write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    await expect(
      buildSkillsetResult(root, { scopes: ["repo"] })
    ).rejects.toThrow("unsupported schemaVersion 4");
    expect(
      await readFile(join(root, ".agents/skills/review/SKILL.md"), "utf-8")
    ).toBe("previous standard output\n");
    expect(
      await Bun.file(
        join(root, "generated/codex-skills/review/SKILL.md")
      ).exists()
    ).toBe(false);
  });

  test("rejects a pre-v3 inactive lock without granting cleanup ownership", async () => {
    const root = await fixture(customCodexConfig());
    await seedManagedStandardRoot(root, [
      { phase: "baseline", standardProfile: "agent-skills" },
    ]);
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf-8"));
    lock.schemaVersion = 2;
    delete lock.provenanceHash;
    delete lock.selectedStandards;
    for (const item of lock.items) {
      delete item.consumers;
      delete item.owner;
    }
    await Bun.write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    await expect(
      buildSkillsetResult(root, { scopes: ["repo"] })
    ).rejects.toThrow("uses pre-v3 schema 2; this generated state is rebuild-only");
    expect(
      await readFile(join(root, ".agents/skills/review/SKILL.md"), "utf-8")
    ).toBe("previous standard output\n");
    expect(
      await Bun.file(
        join(root, "generated/codex-skills/review/SKILL.md")
      ).exists()
    ).toBe(false);
  });

  test("rejects a malformed inactive lock without granting legacy-root ownership", async () => {
    const root = await fixture(customCodexConfig());
    await seedManagedStandardRoot(root, [
      { phase: "baseline", standardProfile: "agent-skills" },
    ]);
    const lockPath = join(root, ".agents/skills/skillset.lock");
    await Bun.write(
      lockPath,
      `${JSON.stringify({ generatedBy: "skillset@0.1.0" }, null, 2)}\n`
    );

    await expect(
      buildSkillsetResult(root, { scopes: ["repo"] })
    ).rejects.toThrow("unsupported schemaVersion undefined");
    expect(
      await readFile(join(root, ".agents/skills/review/SKILL.md"), "utf-8")
    ).toBe("previous standard output\n");
    expect(
      await Bun.file(
        join(root, "generated/codex-skills/review/SKILL.md")
      ).exists()
    ).toBe(false);
  });

  test("rejects traversal in an inactive lock without deleting outside its root", async () => {
    const root = await fixture(customCodexConfig());
    await seedManagedStandardRoot(root, [
      { phase: "baseline", standardProfile: "agent-skills" },
    ]);
    const outsidePath = join(root, ".agents/owned.md");
    const outsideContent = "user-owned\n";
    await Bun.write(outsidePath, outsideContent);
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf-8"));
    lock.items[0].files = ["../owned.md"];
    lock.items[0].fileModes = { "../owned.md": "0644" };
    lock.items[0].outputHash = outputHash("../owned.md", outsideContent);
    await Bun.write(
      lockPath,
      `${JSON.stringify(withLockProvenance(lock), null, 2)}\n`
    );

    await expect(
      buildSkillsetResult(root, { scopes: ["repo"] })
    ).rejects.toThrow("must stay inside its output root");
    expect(await readFile(outsidePath, "utf-8")).toBe(outsideContent);
    expect(
      await Bun.file(
        join(root, "generated/codex-skills/review/SKILL.md")
      ).exists()
    ).toBe(false);
  });

  test("rejects a tampered inactive lock without granting cleanup ownership", async () => {
    const root = await fixture(customCodexConfig());
    await seedManagedStandardRoot(root, [
      { phase: "baseline", standardProfile: "agent-skills" },
    ]);
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf-8"));
    lock.items[0].outputHash = outputHash(
      "review/SKILL.md",
      "different generated content\n"
    );
    await Bun.write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    await expect(
      buildSkillsetResult(root, { scopes: ["repo"] })
    ).rejects.toThrow("invalid provenanceHash");
    expect(
      await readFile(join(root, ".agents/skills/review/SKILL.md"), "utf-8")
    ).toBe("previous standard output\n");
    expect(
      await Bun.file(
        join(root, "generated/codex-skills/review/SKILL.md")
      ).exists()
    ).toBe(false);
  });

  test("inspects invalid provenance only for active paths so managed edits can be backed up", async () => {
    const root = await fixture(defaultCodexConfig());
    const initial = await buildSkillsetResult(root, { scopes: ["repo"] });
    expect(initial.ok).toBe(true);
    const outputPath = join(root, ".agents/skills/review/SKILL.md");
    await Bun.write(outputPath, "user edit\n");
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf-8"));
    lock.provenanceHash = `sha256:${"0".repeat(64)}`;
    await Bun.write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const result = await buildSkillsetResult(root, { scopes: ["repo"] });

    expect(result.ok).toBe(true);
    expect(result.writes.backupRunId).toBeDefined();
    expect(await readFile(outputPath, "utf-8")).toContain("Review the change.");
  });

  test("does not let invalid current provenance add a stale deletion path", async () => {
    const root = await fixture(defaultCodexConfig());
    const initial = await buildSkillsetResult(root, { scopes: ["repo"] });
    expect(initial.ok).toBe(true);
    const userPath = join(root, ".agents/skills/user-owned.txt");
    await Bun.write(userPath, "keep me\n");
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf-8"));
    lock.items.push({
      fileModes: { "user-owned.txt": "0644" },
      files: ["user-owned.txt"],
      outputHash: outputHash("user-owned.txt", "keep me\n"),
    });
    await Bun.write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    await expect(
      buildSkillsetResult(root, { scopes: ["repo"] })
    ).rejects.toThrow("invalid provenanceHash");
    expect(await readFile(userPath, "utf-8")).toBe("keep me\n");
  });

  test("rejects invalid provenance when a current co-consumed Agent Plugins item shares a root with a stale former item", async () => {
    const root = await pluginFixture();
    const initial = await buildSkillsetResult(root, { scopes: ["plugins"] });
    const providerPath = providerOutputPath(initial.data, "plugins/");
    const providerBefore = await readFile(join(root, providerPath), "utf-8");
    const stale = await appendInactiveStandardPluginItem(
      join(root, "plugins"),
      providerPath.slice("plugins/".length)
    );

    await expect(
      buildSkillsetResult(root, { scopes: ["plugins"] })
    ).rejects.toThrow("invalid provenanceHash");

    expect(await readFile(stale.path, "utf-8")).toBe(stale.content);
    expect(await readFile(join(root, providerPath), "utf-8")).toBe(providerBefore);
  });

  test("requires provenance for any unplanned path at the direct managed-state reader seam", async () => {
    const root = await pluginFixture();
    const initial = await buildSkillsetResult(root, { scopes: ["plugins"] });
    const providerPath = providerOutputPath(initial.data, "plugins/");
    await appendInactiveStandardPluginItem(
      join(root, "plugins"),
      providerPath.slice("plugins/".length)
    );
    const policy: ManagedOutputProvenancePolicy = {
      activeRenderedPaths: new Set(initial.data.map((file) => file.path)),
    };
    await expect(
      readManagedOutputState(
        root,
        ["plugins"],
        false,
        (path) => path,
        undefined,
        undefined,
        new Set(),
        policy
      )
    ).rejects.toThrow("invalid provenanceHash");
  });

  test("rejects isolated cleanup when a current co-consumed Agent Plugins item shares a root with a stale former item", async () => {
    const root = await pluginFixture();
    const xdg = {
      env: { XDG_CACHE_HOME: join(root, "xdg-cache") },
      homeDir: root,
    };
    const cacheRoot = resolveRepoOperationalCachePath(root, xdg);
    const initial = await buildSkillsetResult(root, {
      isolated: true,
      scopes: ["plugins"],
      xdg,
    });
    const providerPath = providerOutputPath(
      initial.data,
      ".skillset/cache/latest/plugins/"
    );
    const providerBefore = await readFile(
      join(cacheRoot, "latest", providerPath.replace(".skillset/cache/latest/", "")),
      "utf-8"
    );
    const stale = await appendInactiveStandardPluginItem(
      join(cacheRoot, "latest/plugins"),
      providerPath.slice(".skillset/cache/latest/plugins/".length)
    );

    await expect(
      buildSkillsetResult(root, {
        isolated: true,
        scopes: ["plugins"],
        xdg,
      })
    ).rejects.toThrow("invalid provenanceHash");

    expect(await readFile(stale.path, "utf-8")).toBe(stale.content);
    expect(
      await readFile(
        join(cacheRoot, "latest", providerPath.replace(".skillset/cache/latest/", "")),
        "utf-8"
      )
    ).toBe(providerBefore);
  });

  test("removes an inactive standard plugin root only in plugin scope", async () => {
    const root = await fixture(customCodexConfig());
    await seedManagedPluginRoot(root);
    await Bun.write(join(root, "plugins/unmanaged.txt"), "keep me\n");
    const graph = await loadBuildGraph(root);

    expect(scopedOutputRoots(graph, ["plugins"])).toContain("plugins");
    expect(scopedOutputRoots(graph, ["repo"])).not.toContain("plugins");

    const result = await buildSkillsetResult(root, { scopes: ["plugins"] });

    expect(result.ok).toBe(true);
    expect(result.writes.deletedPaths).toEqual(
      expect.arrayContaining([
        "plugins/demo/plugin.json",
        "plugins/skillset.lock",
      ])
    );
    expect(
      await Bun.file(join(root, "plugins/demo/plugin.json")).exists()
    ).toBe(false);
    expect(await readFile(join(root, "plugins/unmanaged.txt"), "utf-8")).toBe(
      "keep me\n"
    );
  });
});

function defaultCodexConfig(): string {
  return `skillset:
  name: output-plan-lifecycle
compile:
  agents: false
claude: false
codex: true
cursor: false
`;
}

function customCodexConfig(): string {
  return `skillset:
  name: output-plan-lifecycle
compile:
  agents: false
claude: false
codex:
  skills:
    path: generated/codex-skills
cursor: false
`;
}

async function fixture(config: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-output-plan-"));
  await Bun.write(join(root, "skillset.yaml"), config);
  await Bun.write(join(root, ".skillset/skills/review/SKILL.md"), SKILL);
  return root;
}

async function pluginFixture(): Promise<string> {
  const root = await fixture(defaultCodexConfig());
  await Bun.write(
    join(root, ".skillset/plugins/demo/skillset.yaml"),
    "skillset:\n  name: demo\n"
  );
  await Bun.write(
    join(root, ".skillset/plugins/demo/skills/review/SKILL.md"),
    SKILL
  );
  return root;
}

function providerOutputPath(
  files: readonly { readonly path: string }[],
  prefix: string
): string {
  const path = files.find(
    (file) =>
      file.path.startsWith(prefix) &&
      file.path.includes("/codex/") &&
      !file.path.endsWith("/skillset.lock")
  )?.path;
  if (path === undefined) {
    throw new Error(`expected a live provider output under ${prefix}`);
  }
  return path;
}

async function appendInactiveStandardPluginItem(
  outputDirectory: string,
  activeProviderFile: string
): Promise<{ readonly content: string; readonly path: string }> {
  const relativePath = "former/agents/plugin.json";
  const content = '{"name":"former"}\n';
  const path = join(outputDirectory, relativePath);
  await mkdir(join(outputDirectory, "former/agents"), { recursive: true });
  await Bun.write(path, content);
  const lockPath = join(outputDirectory, "skillset.lock");
  const lock = JSON.parse(await readFile(lockPath, "utf-8"));
  const activeItem = lock.items.find(
    (item: { readonly files?: unknown }) =>
      Array.isArray(item.files) && item.files.includes(activeProviderFile)
  );
  if (activeItem === undefined) {
    throw new Error(`expected a current provider lock item for ${activeProviderFile}`);
  }
  // SET-401 has not rendered the standard byte yet. Model its future
  // coalesced ownership on the current provider path; `former` below remains
  // a stale standard-only item eligible for cleanup.
  activeItem.consumers = [
    { phase: "baseline", standardProfile: "agent-plugins-1.0" },
    { phase: "delta", target: "codex" },
  ];
  activeItem.owner = { standardProfile: "agent-plugins-1.0" };
  lock.items.push({
    consumers: [{ phase: "baseline", standardProfile: "agent-plugins-1.0" }],
    fileModes: { [relativePath]: "0644" },
    files: [relativePath],
    name: "former",
    outputHash: outputHash(relativePath, content),
    outputPath: "former",
    owner: { standardProfile: "agent-plugins-1.0" },
    sourcePath: ".skillset/plugins/former/skillset.yaml",
  });
  lock.selectedStandards = ["agent-plugins-1.0"];
  lock.provenanceHash = `sha256:${"0".repeat(64)}`;
  await Bun.write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return { content, path };
}

async function seedManagedStandardRoot(
  root: string,
  consumers: readonly SeedConsumer[],
  prefix = "."
): Promise<void> {
  const outputRoot = join(prefix, ".agents/skills");
  const relativePath = "review/SKILL.md";
  const content = "previous standard output\n";
  await mkdir(join(root, outputRoot, "review"), { recursive: true });
  await Bun.write(join(root, outputRoot, relativePath), content);
  const standardOwner = consumers.find(
    (consumer) => "standardProfile" in consumer
  );
  const providerOwner = consumers.find((consumer) => "target" in consumer);
  const owner =
    standardOwner === undefined
      ? { target: providerOwner!.target }
      : { standardProfile: standardOwner.standardProfile };
  const lock = withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [
      {
        consumers: [...consumers],
        fileModes: { [relativePath]: "0644" },
        files: [relativePath],
        name: "review",
        outputHash: outputHash(relativePath, content),
        outputPath: "review",
        owner,
        sourcePath: ".skillset/skills/review/SKILL.md",
      },
    ],
    outputRoot: ".agents/skills",
    schemaVersion: 3,
    selectedStandards: ["agent-skills"],
    selectedTargets: consumers.some(
      (consumer) => "target" in consumer && consumer.target === "codex"
    )
      ? ["codex"]
      : [],
    target: "workspace",
  });
  await Bun.write(
    join(root, outputRoot, "skillset.lock"),
    `${JSON.stringify(lock, null, 2)}\n`
  );
}

async function seedManagedPluginRoot(root: string): Promise<void> {
  const outputRoot = "plugins";
  const relativePath = "demo/plugin.json";
  const content = '{"name":"demo"}\n';
  await mkdir(join(root, outputRoot, "demo"), { recursive: true });
  await Bun.write(join(root, outputRoot, relativePath), content);
  await Bun.write(
    join(root, outputRoot, "skillset.lock"),
    `${JSON.stringify(
      withLockProvenance({
        generatedBy: "skillset@0.1.0",
        items: [
          {
            consumers: [
              { phase: "baseline", standardProfile: "agent-plugins-1.0" },
            ],
            fileModes: { [relativePath]: "0644" },
            files: [relativePath],
            name: "demo",
            outputHash: outputHash(relativePath, content),
            outputPath: "demo",
            owner: { standardProfile: "agent-plugins-1.0" },
            sourcePath: ".skillset/plugins/demo/plugin.yaml",
          },
        ],
        outputRoot,
        schemaVersion: 3,
        selectedStandards: ["agent-plugins-1.0"],
        selectedTargets: [],
        target: "workspace",
      }),
      null,
      2
    )}\n`
  );
}

function outputHash(path: string, content: string): string {
  const hash = createHash("sha256");
  hash.update("skillset-output-v2\0");
  hash.update(path);
  hash.update("\0");
  hash.update("0644\0");
  hash.update(content);
  hash.update("\0");
  return `sha256:${hash.digest("hex")}`;
}
