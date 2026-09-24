import { describe, expect, it } from "bun:test";
import { lstat } from "node:fs/promises";
import { relative } from "node:path";

import { validateTestSandbox } from "../../apps/skillset/src/verification-sandbox";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

describe("test fixture root", () => {
  it("creates a real directory under the owned sandbox", async () => {
    const sandbox = await validateTestSandbox();
    const root = await createTestFixtureRoot("skillset-fixture-root-");
    expect(relative(sandbox.descriptor.sandboxPath, root)).toMatch(
      /^skillset-fixture-root-[^/]+$/u
    );
    expect((await lstat(root)).isDirectory()).toBe(true);
  });

  it.each(["", ".", "..", "../escape-", "nested/path-", "nested\\path-"])(
    "rejects unsafe prefix %s",
    async (prefix) => {
      await expect(createTestFixtureRoot(prefix)).rejects.toThrow(
        "Test fixture prefix must be a non-empty safe basename"
      );
    }
  );
});
