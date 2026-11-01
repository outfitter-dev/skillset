import { expect, test } from "bun:test";
import { chmod, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import * as core from "@skillset/core";
import type { WorkspaceTransactionOptions } from "@skillset/core/internal/workspace-transaction";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { readFoldedLedger } from "../../../../scripts/test-helpers/change-ledger";
import { runDraftCommand, type DraftCommandCore } from "../draft-cli";
import { runMoveCommand } from "../move-cli";
import { runPromoteCommand, type PromoteCommandCore } from "../promote-cli";
import { withLifecycleLedgerLock } from "../lifecycle-ledger-lock";
import type { LifecycleLedgerLock } from "../lifecycle-ledger-lock";

const shippedPath = ".skillset/skills/alpha";
const draftPath = ".skillset/skills/_drafts/alpha";
const movedPath = ".skillset/plugins/tools/skills/alpha";
const lockDirectory = ".skillset/changes/ledger.jsonl.lock";
const kinds = ["draft", "move", "promote"] as const;
type Kind = (typeof kinds)[number];

test.each(kinds)("%s rolls back source, outputs and events after losing its lease at append [SET-745]", async (kind) => {
  const root = await fixture(kind);
  const before = await snapshot(root);
  let reachedAppend = false;
  try {
    await expect(run(kind, root, {
      testHooks: {
        beforeApply: async (operation) => {
          if (operation.kind !== "append") return;
          reachedAppend = true;
          const installedPath = kind === "move" ? movedPath : kind === "draft" ? draftPath : shippedPath;
          expect(await Bun.file(join(root, installedPath, "SKILL.md")).exists()).toBe(true);
          await loseClaim(root);
        },
      },
    })).rejects.toThrow("lost ownership of change ledger lock");
    expect(reachedAppend).toBe(true);
    expect(await snapshot(root)).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("draft refuses an already-lost lifecycle lease after replanning", async () => {
  const root = await fixture("draft");
  const before = await snapshot(root);
  try {
    await expect(run("draft", root, undefined, true)).rejects.toThrow("lost ownership of change ledger lock");
    expect(await snapshot(root)).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(kinds)("%s appends its lifecycle event while its lease remains owned", async (kind) => {
  const root = await fixture(kind);
  const before = (await readFoldedLedger(root)).split("\n").filter(Boolean).length;
  try {
    await run(kind, root);
    const events = (await readFoldedLedger(root)).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)?.type).toBe({ draft: "source.drafted", move: "source.moved", promote: "source.promoted" }[kind]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function run(kind: Kind, rootPath: string, transactionOptions?: WorkspaceTransactionOptions, loseAfterAcquisition = false) {
  const ledgerLock: LifecycleLedgerLock = (root, operation) => withLifecycleLedgerLock(root, {
    ...(loseAfterAcquisition ? { afterLockAcquired: () => loseClaim(root) } : {}),
  }, operation);
  const context = { ledgerLock, write: () => undefined };
  const applyOptions = transactionOptions === undefined ? {} : { transactionOptions };
  const request = { jsonOutput: false, rootPath, yes: true };
  if (kind === "draft") {
    return runDraftCommand({ ...request, shippedPath }, {
      ...context,
      core: { ...core, draftSource: (input: Parameters<typeof core.draftSource>[0]) => core.draftSource({ ...input, ...applyOptions }) } as unknown as DraftCommandCore,
    });
  }
  if (kind === "move") {
    return runMoveCommand({ ...request, from: shippedPath, to: movedPath }, {
      ...context,
      core: { ...core, moveSource: (input) => core.moveSource({ ...input, ...applyOptions }) },
    });
  }
  return runPromoteCommand({ ...request, draftPath }, {
    ...context,
    core: { ...core, promoteSource: (input: Parameters<typeof core.promoteSource>[0]) => core.promoteSource({ ...input, ...applyOptions }) } as unknown as PromoteCommandCore,
  });
}

async function loseClaim(root: string) {
  const directory = join(root, lockDirectory);
  const claims = (await readdir(directory)).filter((name) => name.startsWith("claim-"));
  expect(claims).toHaveLength(1);
  await rm(join(directory, claims[0]!), { recursive: true });
}

async function fixture(kind: Kind) {
  const root = await createTestFixtureRoot("lifecycle-fence-");
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: fence-test\ncompile:\n  targets: [codex]\n");
  await Bun.write(join(root, shippedPath, "SKILL.md"), "---\nname: alpha\ndescription: Alpha skill.\n---\nAlpha.\n");
  await Bun.write(join(root, shippedPath, "scripts/check.sh"), "#!/bin/sh\necho alpha\n");
  if (process.platform !== "win32") await chmod(join(root, shippedPath, "scripts/check.sh"), 0o755);
  await Bun.write(join(root, ".skillset/plugins/tools/skillset.yaml"), "skillset:\n  name: tools\n");
  await core.buildSkillset(root);
  if (kind === "promote") {
    await run("draft", root);
    await Bun.write(join(root, draftPath, "SKILL.md"), "---\nname: alpha\ndescription: Alpha skill.\n---\nRevised alpha.\n");
    await core.buildSkillset(root);
  }
  return root;
}

async function snapshot(root: string) {
  const files = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true }));
  const result: Record<string, { bytes: string; mode: number }> = {};
  for (const path of files.sort()) {
    // The deliberately invalidated lease is external coordination state.
    if (path.startsWith(`${lockDirectory}/`)) continue;
    result[path] = { bytes: (await readFile(join(root, path))).toString("base64"), mode: (await stat(join(root, path))).mode & 0o777 };
  }
  return result;
}
