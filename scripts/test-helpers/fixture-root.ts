import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { validateTestSandbox } from "../../apps/skillset/src/verification-sandbox";

export async function createTestFixtureRoot(prefix: string): Promise<string> {
  const sandbox = await validateTestSandbox();
  return mkdtemp(
    join(sandbox.descriptor.sandboxPath, validateFixturePrefix(prefix))
  );
}

const TEMP_DIRECTORY_VARIABLES = ["TMPDIR", "TEMP", "TMP"] as const;

/**
 * Runs `action` with the OS temp directory pointed at an owned, empty fixture root
 * and returns its result with the `prefix` entries the action left there. Tests that prove
 * production code cleans up its temporary roots use this instead of scanning the
 * shared OS temp directory, which races with concurrent test runs creating and
 * removing their own roots.
 *
 * Inside `action`, the test sandbox's own temp checks see the redirect: do not
 * call `validateTestSandbox` or `createTestFixtureRoot` there, and create
 * fixtures before calling this. An action that outlives the test timeout leaves
 * the redirect in place for the rest of the file.
 */
export async function tempEntriesLeftBy<T>(
  prefix: string,
  action: () => Promise<T>
): Promise<{ readonly result: T; readonly leftovers: readonly string[] }> {
  const ownedTemp = await createTestFixtureRoot("skillset-owned-temp-");
  const previous = TEMP_DIRECTORY_VARIABLES.map((name) => [name, process.env[name]] as const);
  for (const name of TEMP_DIRECTORY_VARIABLES) process.env[name] = ownedTemp;
  let result: T;
  try {
    if (tmpdir() !== ownedTemp) {
      throw new Error(`os.tmpdir() ignored the redirect to ${ownedTemp}`);
    }
    result = await action();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const leftovers = (await readdir(ownedTemp)).filter((name) => name.startsWith(prefix)).toSorted();
  return { leftovers, result };
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
