import { expect, test } from "bun:test";
import type { Stats } from "node:fs";
import { mkdir, readFile, readlink, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { buildSkillset } from "@skillset/core";
import { readChangeLedger } from "@skillset/core/internal/change-ledger";
import { draftSource, planSourceDraft, planSourcePromotion } from "@skillset/core/internal/source-draft";
import { moveSource, planSourceMove } from "@skillset/core/internal/source-move";
import { sourceLifecycleLedgerRecord } from "@skillset/core/internal/source-lifecycle-ledger";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { scaffoldSourceUnit } from "../new-source";

for (const plugin of [undefined, "tools"]) {
  test(`SET-671: fresh ${plugin ?? "workspace"} draft closes its abandoned fork, but edits keep it`, async () => {
    const { root, shipped, draft, fork } = await forkFixture(plugin);
    await writeFile(join(root, draft, "SKILL.md"), skill("Edited draft."));
    await buildSkillset(root);
    const edited = await planSourcePromotion({ rootPath: root, draftPath: draft });
    expect(edited.baselineSourceHash).toBe(fork.sourceHash);

    await rm(join(root, draft), { recursive: true });
    const options = { kind: "skill" as const, id: "demo", draft: true, ...(plugin === undefined ? {} : { container: plugin }) };
    const before = await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8");
    const preview = await scaffoldSourceUnit(root, options);
    expect(preview.files).toContainEqual({ operation: "update", path: ".skillset/changes/ledger.jsonl" });
    expect(await Bun.file(join(root, draft, "SKILL.md")).exists()).toBe(false);
    expect(await readFile(join(root, ".skillset/changes/ledger.jsonl"), "utf8")).toBe(before);

    await scaffoldSourceUnit(root, { ...options, write: true });
    const events = await readChangeLedger(root);
    expect(events.at(-1)).toMatchObject({
      type: "source.draft-discarded",
      payload: { draftEventId: events[0]?.id },
    });
    await buildSkillset(root);
    const fresh = await planSourcePromotion({ rootPath: root, draftPath: draft });
    expect(fresh).not.toHaveProperty("baselineSourceHash");
    expect(fresh.changedSinceDraft).toBeNull();
    expect(fresh.warnings.join("\n")).toContain("no recorded fork baseline");
    expect(await Bun.file(join(root, shipped, "SKILL.md")).text()).toContain("Shipped demo.");
  });
}

test("SET-671: failed fresh draft append rolls back created files and preserves fork records", async () => {
  const { root, draft } = await forkFixture();
  await rm(join(root, draft), { recursive: true });
  const ledger = join(root, ".skillset/changes/ledger.jsonl");
  const before = await readFile(ledger, "utf8");
  await expect(scaffoldSourceUnit(root, {
    kind: "skill", id: "demo", draft: true, write: true,
    transactionOptions: { testHooks: { beforeApply: (operation) => {
      if (operation.kind === "append") throw new Error("injected append failure");
    } } },
  })).rejects.toThrow("injected append failure");
  expect(await Bun.file(join(root, draft, "SKILL.md")).exists()).toBe(false);
  expect(await readFile(ledger, "utf8")).toBe(before);
});

test("SET-671: resource-only fork refuses preview and creation without losing provenance", async () => {
  const { root, draft, fork } = await forkFixture(undefined, true);
  await rm(join(root, draft, "SKILL.md"));
  const ledger = join(root, ".skillset/changes/ledger.jsonl");
  const before = await readFile(ledger, "utf8");
  for (const write of [false, true]) {
    await expect(scaffoldSourceUnit(root, {
      kind: "skill", id: "demo", draft: true, write,
    })).rejects.toThrow("refusing to discard the fork baseline while draft content remains");
    expect(await Bun.file(join(root, draft, "SKILL.md")).exists()).toBe(false);
    expect(await readFile(join(root, draft, "references/api.md"), "utf8")).toBe("Authored resource.\n");
    expect(await readFile(ledger, "utf8")).toBe(before);
  }
  await writeFile(join(root, draft, "SKILL.md"), skill("Restored fork."));
  await buildSkillset(root);
  expect((await planSourcePromotion({ rootPath: root, draftPath: draft })).baselineSourceHash).toBe(fork.sourceHash);
});

test("SET-671: resource inserted before append prevents fork closure and survives rollback", async () => {
  const { root, draft } = await forkFixture();
  await rm(join(root, draft), { recursive: true });
  await mkdir(join(root, draft));
  const ledger = join(root, ".skillset/changes/ledger.jsonl");
  const before = await readFile(ledger, "utf8");
  await expect(scaffoldSourceUnit(root, {
    kind: "skill", id: "demo", draft: true, write: true,
    transactionOptions: { testHooks: { beforeApply: async (operation) => {
      if (operation.kind === "append") await writeFile(join(root, draft, "retained.md"), "Late authored resource.\n");
    } } },
  })).rejects.toThrow("refusing to discard the fork baseline while draft content remains");
  expect(await Bun.file(join(root, draft, "SKILL.md")).exists()).toBe(false);
  expect(await readFile(join(root, draft, "retained.md"), "utf8")).toBe("Late authored resource.\n");
  expect(await readFile(ledger, "utf8")).toBe(before);
});

test("SET-671: directory inserted at a planned file before install survives refusal", async () => {
  const { root, draft } = await forkFixture();
  await rm(join(root, draft), { recursive: true });
  await mkdir(join(root, draft));
  const ledger = join(root, ".skillset/changes/ledger.jsonl");
  const before = await readFile(ledger, "utf8");
  await expect(scaffoldSourceUnit(root, {
    kind: "skill", id: "demo", draft: true, write: true,
    transactionOptions: { testHooks: { beforeApply: async (operation) => {
      if (operation.kind === "write") await mkdir(join(root, draft, "SKILL.md"));
    } } },
  })).rejects.toThrow();
  expect(await Bun.file(join(root, draft, "SKILL.md")).exists()).toBe(false);
  expect(await readFile(ledger, "utf8")).toBe(before);
  // It never became a transaction-owned write, so the foreign directory stays.
  expect((await stat(join(root, draft, "SKILL.md"))).isDirectory()).toBe(true);
});

test("SET-671: foreign directory replacing installed draft survives refused fork closure", async () => {
  const { root, draft } = await forkFixture();
  await rm(join(root, draft), { recursive: true });
  const ledger = join(root, ".skillset/changes/ledger.jsonl");
  const before = await readFile(ledger, "utf8");
  const replacement = join(root, draft, "SKILL.md");
  await expect(scaffoldSourceUnit(root, {
    kind: "skill", id: "demo", draft: true, write: true,
    transactionOptions: { testHooks: { beforeApply: async (operation) => {
      if (operation.kind !== "append") return;
      await rm(replacement);
      await mkdir(replacement);
      await writeFile(join(replacement, "authored.md"), "Concurrent authored content.\n");
    } } },
  })).rejects.toThrow("refusing to discard the fork baseline while draft content remains");
  expect((await stat(replacement)).isDirectory()).toBe(true);
  expect(await readFile(join(replacement, "authored.md"), "utf8")).toBe("Concurrent authored content.\n");
  expect(await readFile(ledger, "utf8")).toBe(before);
});

for (const replacementKind of ["restored", "edited", "identical replacement"] as const) {
  test(`SET-671: ${replacementKind} entrypoint survives refusal without closing its fork`, async () => {
    const { root, draft } = await forkFixture();
    const entrypoint = join(root, draft, "SKILL.md");
    const forkContent = await readFile(entrypoint, "utf8");
    await rm(join(root, draft), { recursive: true });
    const ledger = join(root, ".skillset/changes/ledger.jsonl");
    const before = await readFile(ledger, "utf8");
    let replacement = "";
    await expect(scaffoldSourceUnit(root, {
      kind: "skill", id: "demo", draft: true, write: true,
      transactionOptions: { testHooks: { beforeApply: async (operation) => {
        if (operation.kind !== "append") return;
        const scaffold = await readFile(entrypoint, "utf8");
        replacement = replacementKind === "restored" ? forkContent
          : replacementKind === "edited" ? `${scaffold}\nConcurrent authored edit.\n`
          : scaffold;
        if (replacementKind === "edited") {
          await writeFile(entrypoint, replacement);
        } else {
          const incoming = join(root, "replacement-SKILL.md");
          await writeFile(incoming, replacement);
          await rename(entrypoint, join(root, "saved-scaffold-SKILL.md"));
          await rename(incoming, entrypoint);
        }
      } } },
    })).rejects.toThrow("expected-absent write changed after installation");
    expect(await readFile(entrypoint, "utf8")).toBe(replacement);
    expect(await readFile(ledger, "utf8")).toBe(before);
  });
}

test.skipIf(process.platform === "win32")("SET-671: foreign symlink survives refused fork closure without a recovery journal", async () => {
  const { root, draft } = await forkFixture();
  await rm(join(root, draft), { recursive: true });
  const ledger = join(root, ".skillset/changes/ledger.jsonl");
  const before = await readFile(ledger, "utf8");
  const entrypoint = join(root, draft, "SKILL.md");
  const authored = join(root, "authored.md");
  await writeFile(authored, "Concurrent authored content.\n");
  await expect(scaffoldSourceUnit(root, {
    kind: "skill", id: "demo", draft: true, write: true,
    transactionOptions: { testHooks: { beforeApply: async (operation) => {
      if (operation.kind !== "append") return;
      await rm(entrypoint);
      await symlink(authored, entrypoint);
    } } },
  })).rejects.toThrow("refusing to discard the fork baseline while draft content remains");
  expect(await readlink(entrypoint)).toBe(authored);
  expect(await readFile(authored, "utf8")).toBe("Concurrent authored content.\n");
  expect(await readFile(ledger, "utf8")).toBe(before);
  expect((await readdir(root)).filter((name) => name.startsWith(".skillset-workspace-transaction-"))).toEqual([]);
});

for (const populated of [false, true]) {
  test(`SET-671: foreign ${populated ? "populated" : "empty"} draft directory survives failed closure`, async () => {
    const { root, draft } = await forkFixture();
    const draftPath = join(root, draft);
    await rm(draftPath, { recursive: true });
    const ledger = join(root, ".skillset/changes/ledger.jsonl");
    const before = await readFile(ledger, "utf8");
    let replacementIdentity: Stats | undefined;
    await expect(scaffoldSourceUnit(root, {
      kind: "skill", id: "demo", draft: true, write: true,
      transactionOptions: { testHooks: { beforeApply: async (operation) => {
        if (operation.kind !== "append") return;
        await rename(draftPath, join(root, "saved-scaffold-draft"));
        await mkdir(draftPath, { mode: 0o700 });
        replacementIdentity = await stat(draftPath);
        if (populated) await writeFile(join(draftPath, "authored.md"), "Concurrent authored resource.\n");
      } } },
    })).rejects.toThrow(populated
      ? "refusing to discard the fork baseline while draft content remains"
      : "expected-absent write changed after installation");
    const retained = await stat(draftPath);
    expect(retained.isDirectory()).toBe(true);
    expect(retained.dev).toBe(replacementIdentity!.dev);
    expect(retained.ino).toBe(replacementIdentity!.ino);
    expect(retained.mode).toBe(replacementIdentity!.mode);
    if (populated) expect(await readFile(join(draftPath, "authored.md"), "utf8")).toBe("Concurrent authored resource.\n");
    else expect(await readdir(draftPath)).toEqual([]);
    expect(await readFile(ledger, "utf8")).toBe(before);
    expect((await readdir(root)).filter((name) => name.startsWith(".skillset-workspace-transaction-"))).toEqual([]);
  });
}

test("SET-671: closing a moved fork does not close an unrelated reused selector", async () => {
  const { root, draft, fork } = await forkFixture();
  await scaffoldSourceUnit(root, { kind: "plugin", id: "tools", write: true });
  await buildSkillset(root);
  const request = { rootPath: root, from: ".skillset/skills/demo", to: ".skillset/plugins/tools/skills/demo" };
  const move = await planSourceMove(request);
  await moveSource({ ...request, expectedPlanHash: move.planHash });
  const movedDraft = ".skillset/plugins/tools/skills/_drafts/demo";
  // `new` currently scaffolds the root skill. Reusing its old selector
  // cannot borrow or close the fork carried into the tools plugin.
  await scaffoldSourceUnit(root, { kind: "skill", id: "demo", draft: true, write: true });
  expect((await readChangeLedger(root)).filter((event) => event.type === "source.draft-discarded")).toHaveLength(0);
  await buildSkillset(root);
  expect((await planSourcePromotion({ rootPath: root, draftPath: movedDraft })).baselineSourceHash).toBe(fork.sourceHash);
  expect(await Bun.file(join(root, draft, "SKILL.md")).exists()).toBe(true);
});

test("SET-671: retiring the newest fork never resurrects an older abandoned baseline", async () => {
  const { root, shipped, draft } = await forkFixture();
  await rm(join(root, draft), { recursive: true });
  await buildSkillset(root);
  const request = { rootPath: root, shippedPath: shipped };
  const second = await planSourceDraft(request);
  await draftSource({ ...request, expectedPlanHash: second.planHash });
  await rm(join(root, draft), { recursive: true });
  await scaffoldSourceUnit(root, { kind: "skill", id: "demo", draft: true, write: true });
  await buildSkillset(root);
  const fresh = await planSourcePromotion({ rootPath: root, draftPath: draft });
  expect(fresh.changedSinceDraft).toBeNull();
  expect(fresh).not.toHaveProperty("baselineSourceHash");
  const events = await readChangeLedger(root);
  expect(events.at(-1)).toMatchObject({ type: "source.draft-discarded", payload: { draftEventId: events[1]?.id } });
});

test("SET-671: independent creations closing the same fork have distinct event ids", () => {
  const event = { type: "source.draft-discarded" as const, payload: {
    draft: "skill:demo#draft", draftEventId: "fork-1", shipped: "skill:demo",
  } };
  expect(sourceLifecycleLedgerRecord("", event, 1)).not.toEqual(sourceLifecycleLedgerRecord("", event, 1));
});

function skill(description: string): string {
  return `---\nname: demo\ndescription: ${description}\n---\n\n${description}\n`;
}

async function forkFixture(plugin?: string, resource = false) {
  const root = await createTestFixtureRoot("skillset-new-fork-");
  const skills = plugin === undefined ? ".skillset/skills" : `.skillset/plugins/${plugin}/skills`;
  const shipped = `${skills}/demo`;
  const draft = `${skills}/_drafts/demo`;
  const files: Record<string, string> = {
    "skillset.yaml": "skillset:\n  name: draft-reset\ncompile:\n  targets: [codex]\n",
    [`${shipped}/SKILL.md`]: skill("Shipped demo."),
    ...(resource ? { [`${shipped}/references/api.md`]: "Authored resource.\n" } : {}),
    ...(plugin === undefined ? {} : { [`.skillset/plugins/${plugin}/skillset.yaml`]: `skillset:\n  name: ${plugin}\n` }),
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await buildSkillset(root);
  const fork = await planSourceDraft({ rootPath: root, shippedPath: shipped });
  await draftSource({ rootPath: root, shippedPath: shipped, expectedPlanHash: fork.planHash });
  return { root, shipped, draft, fork };
}
