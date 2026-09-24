import { mkdtemp } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { validateTestSandbox } from "../../apps/skillset/src/verification-sandbox";

export async function createTestFixtureRoot(prefix: string): Promise<string> {
  const sandbox = await validateTestSandbox();
  return mkdtemp(
    join(sandbox.descriptor.sandboxPath, validateFixturePrefix(prefix))
  );
}

function validateFixturePrefix(prefix: string): string {
  if (
    prefix.length === 0 ||
    prefix === "." ||
    prefix === ".." ||
    isAbsolute(prefix) ||
    prefix.includes("/") ||
    prefix.includes("\\")
  ) {
    throw new Error("Test fixture prefix must be a non-empty safe basename");
  }
  return prefix;
}
