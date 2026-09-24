import { expect, test } from "bun:test";

import { removeTemporaryRootBestEffort } from "../temporary-root";

test("temporary cleanup reports a removal failure without replacing the primary outcome", async () => {
  const calls: unknown[] = [];
  const warnings: string[] = [];
  const removed = await removeTemporaryRootBestEffort(
    "/owned-temporary-root",
    async (path, options) => {
      calls.push({ path, options });
      throw new Error("busy");
    },
    (message) => warnings.push(message)
  );

  expect(removed).toBe(false);
  expect(calls).toEqual([{
    path: "/owned-temporary-root",
    options: { force: true, recursive: true },
  }]);
  expect(warnings).toEqual([
    "skillset: could not remove temporary root /owned-temporary-root: busy",
  ]);
});

test("temporary cleanup succeeds without warning", async () => {
  const warnings: string[] = [];
  const removed = await removeTemporaryRootBestEffort(
    "/owned-temporary-root",
    async () => {},
    (message) => warnings.push(message)
  );

  expect(removed).toBe(true);
  expect(warnings).toEqual([]);
});

test("a broken warning sink cannot replace a cleanup failure", async () => {
  const removed = await removeTemporaryRootBestEffort(
    "/owned-temporary-root",
    async () => {
      throw new Error("busy");
    },
    () => {
      throw new Error("warning sink failed");
    }
  );

  expect(removed).toBe(false);
});
