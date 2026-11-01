import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { withChangeLedgerLock } from "../change-ledger-lock";

test("ledger contention explains long lifecycle/release holders without entering the mutation [SET-745]", async () => {
  const root = await createTestFixtureRoot("ledger-contention-");
  let entered = false;
  try {
    await withChangeLedgerLock(root, undefined, undefined, async (owner) => {
      const failure = await withChangeLedgerLock(root, undefined, { pollMs: 1, timeoutMs: 20 }, async () => {
        entered = true;
      }).then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain("timed out waiting for change ledger lock .skillset/changes/ledger.jsonl.lock after 20ms");
      expect(message).toContain("release apply and draft/promote/move --yes can hold this lock during builds and verification");
      expect(message).toContain("wait for the ongoing operation to finish, then rerun");
      expect(entered).toBe(false);
      await owner.assertOwned();
    });
    await withChangeLedgerLock(root, undefined, undefined, async () => { entered = true; });
    expect(entered).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
