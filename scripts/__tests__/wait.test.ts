import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";
import { waitForCondition, waitForPath } from "../test-helpers/wait";

test("waitForCondition resolves once the predicate becomes true", async () => {
  let ready = false;
  const becomeReady = setTimeout(() => {
    ready = true;
  }, 20);

  try {
    await waitForCondition("local readiness flag", () => ready, {
      intervalMs: 5,
      timeoutMs: 1_000,
    });
  } finally {
    clearTimeout(becomeReady);
  }
});

test("waitForCondition names the condition and elapsed bound on timeout", async () => {
  await expect(
    waitForCondition("missing readiness flag", () => false, {
      intervalMs: 5,
      timeoutMs: 20,
    })
  ).rejects.toThrow("timed out after 20ms waiting for missing readiness flag");
});

test("waitForCondition includes the path when one is supplied", async () => {
  const path = "/tmp/skillset-wait-missing-marker";
  await expect(
    waitForCondition("missing worker marker", () => false, {
      intervalMs: 5,
      path,
      timeoutMs: 20,
    })
  ).rejects.toThrow(
    `timed out after 20ms waiting for missing worker marker at ${path}`
  );
});

test("waitForPath observes a created marker and names a missing one", async () => {
  const root = await createTestFixtureRoot("skillset-wait-path-");
  const path = join(root, "ready");
  const create = setTimeout(() => {
    void writeFile(path, "ready\n");
  }, 20);

  try {
    await waitForPath(path, "created test marker", {
      intervalMs: 5,
      timeoutMs: 1_000,
    });
    await expect(
      waitForPath(join(root, "absent"), "absent test marker", {
        intervalMs: 5,
        timeoutMs: 20,
      })
    ).rejects.toThrow(
      `timed out after 20ms waiting for absent test marker at ${join(root, "absent")}`
    );
  } finally {
    clearTimeout(create);
  }
});

test("waitForCondition rejects an empty description", async () => {
  await expect(waitForCondition("  ", () => true)).rejects.toThrow(
    "waitForCondition requires a description"
  );
});
