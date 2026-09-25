import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";
import { withLockProvenance } from "../lock-provenance";
import {
  isWorkspaceLockPath,
  readCurrentGeneratedLockFromDisk,
  readInspectableGeneratedLockFromDisk,
  readLegacyGeneratedLockFromDisk,
} from "../generated-lock-read";
import { readManagedOutputState } from "../output-safety";
import { liveRenderDestination } from "../build-destination";
import { readExistingMarketplaceState } from "../render-marketplaces";

function errno(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code} failure`), { code });
}

const currentLock = () =>
  withLockProvenance({
    generatedBy: "skillset@0.1.0",
    items: [],
    outputRoot: ".",
    schemaVersion: 4,
    standardProfileEvidence: {},
    selectedStandards: [],
    selectedTargets: [],
    target: "workspace",
  });

const emptyV2Lock = {
  generatedBy: "skillset@0.1.0",
  items: [],
  outputRoot: ".",
  schemaVersion: 2,
  selectedTargets: [],
  target: "workspace",
} as const;

test.each([
  {
    expected: "it is not valid JSON",
    name: "invalid JSON",
    write: async (path: string) => writeFile(path, "{ not valid json", "utf8"),
  },
  {
    expected: "must be an object",
    name: "invalid shape",
    write: async (path: string) => writeFile(path, "[]", "utf8"),
  },
  {
    expected: "has invalid provenanceHash",
    name: "bad required provenance",
    write: async (path: string) =>
      writeFile(
        path,
        JSON.stringify({
          generatedBy: "skillset@0.1.0",
          items: [],
          outputRoot: ".",
          provenanceHash: "sha256:deadbeef",
          schemaVersion: 4,
          standardProfileEvidence: {},
          selectedStandards: [],
          selectedTargets: [],
          target: "workspace",
        }),
        "utf8"
      ),
  },
  {
    expected: 'its outputRoot "plugins" is not the workspace root',
    name: "wrong output root",
    write: async (path: string) =>
      writeFile(
        path,
        JSON.stringify(
          withLockProvenance({
            ...currentLock(),
            outputRoot: "plugins",
          })
        ),
        "utf8"
      ),
  },
] as const)("fails closed for $name and names the lock path", async ({ expected, write }) => {
  const root = await createTestGitFixtureRoot("skillset-lock-read-corrupt-");
  const path = join(root, "skillset.lock");
  await write(path);

  await expect(
    readCurrentGeneratedLockFromDisk(path, {
      expectedOutputRoot: ".",
      logicalPath: "skillset.lock",
      missing: "absent",
    })
  ).rejects.toThrow(
    `workspace lock skillset.lock cannot guard generated state because ${expected}`
  );
  await expect(
    readCurrentGeneratedLockFromDisk(path, {
      expectedOutputRoot: ".",
      logicalPath: "skillset.lock",
      missing: "absent",
    })
  ).rejects.toThrow(
    "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
  );
});

test.each(["EACCES", "EIO", "ELOOP"] as const)(
  "does not downgrade %s to absence",
  async (code) => {
    const path = "/tmp/skillset.lock";
    await expect(
      readCurrentGeneratedLockFromDisk(path, {
        logicalPath: "skillset.lock",
        missing: "absent",
        readText: async () => {
          throw errno(code);
        },
      })
    ).rejects.toThrow(
      `workspace lock skillset.lock cannot guard generated state because it cannot be read (${code})`
    );
    await expect(
      readCurrentGeneratedLockFromDisk(path, {
        logicalPath: "skillset.lock",
        missing: "absent",
        readText: async () => {
          throw errno(code);
        },
      })
    ).rejects.toMatchObject({ code, path });
  }
);

test.each([
  {
    expected: "workspace lock skillset.lock",
    logicalPath: "skillset.lock",
  },
  {
    expected: "workspace lock .skillset/cache/latest/skillset.lock",
    logicalPath: ".skillset/cache/latest/skillset.lock",
  },
  {
    expected: "generated lock plugins/skillset.lock",
    logicalPath: "plugins/skillset.lock",
  },
  {
    expected: "generated lock .skillset/cache/latest/plugins/skillset.lock",
    logicalPath: ".skillset/cache/latest/plugins/skillset.lock",
  },
] as const)("classifies $logicalPath for recovery guidance", async ({ expected, logicalPath }) => {
  expect(isWorkspaceLockPath(logicalPath)).toBe(expected.startsWith("workspace lock"));
  await expect(
    readCurrentGeneratedLockFromDisk("/tmp/skillset.lock", {
      logicalPath,
      missing: "absent",
      readText: async () => {
        throw errno("EACCES");
      },
    })
  ).rejects.toThrow(
    `${expected} cannot guard generated state because it cannot be read (EACCES)`
  );
  await expect(
    readCurrentGeneratedLockFromDisk("/tmp/skillset.lock", {
      logicalPath,
      missing: "absent",
      readText: async () => {
        throw errno("EACCES");
      },
    })
  ).rejects.toThrow(
    expected.startsWith("workspace lock")
      ? "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
      : "Fix or remove the lock before running build, check, or diff."
  );
});

test("isolated output-safety remaps keep workspace recovery on the workspace lock", async () => {
  const root = await createTestGitFixtureRoot("skillset-lock-read-isolated-");
  const isolated = (path: string) => join(".skillset/cache/latest", path);
  await mkdir(join(root, ".skillset/cache/latest/plugins"), { recursive: true });
  await writeFile(join(root, isolated("skillset.lock")), "{ not valid json", "utf8");
  await writeFile(join(root, isolated("plugins/skillset.lock")), "{ not valid json", "utf8");

  await expect(readManagedOutputState(root, [], true, isolated)).rejects.toThrow(
    "workspace lock .skillset/cache/latest/skillset.lock cannot guard generated state because it is not valid JSON"
  );
  await expect(readManagedOutputState(root, [], true, isolated)).rejects.toThrow(
    "Restore it from a clean build (skillset build) or remove it deliberately before rebuilding."
  );
  await expect(readManagedOutputState(root, ["plugins"], false, isolated)).rejects.toThrow(
    "generated lock .skillset/cache/latest/plugins/skillset.lock cannot guard generated state because it is not valid JSON"
  );
  await expect(readManagedOutputState(root, ["plugins"], false, isolated)).rejects.toThrow(
    "Fix or remove the lock before running build, check, or diff."
  );
});

test("missing locks are absent only when the caller allows it", async () => {
  const root = await createTestGitFixtureRoot("skillset-lock-read-missing-");
  const path = join(root, "skillset.lock");

  await expect(
    readCurrentGeneratedLockFromDisk(path, {
      logicalPath: "skillset.lock",
      missing: "absent",
    })
  ).resolves.toEqual({ kind: "absent" });
  await expect(
    readCurrentGeneratedLockFromDisk(path, {
      logicalPath: "skillset.lock",
      missing: "error",
    })
  ).rejects.toThrow(
    "workspace lock skillset.lock cannot guard generated state because it is missing"
  );
});

test("reads a provenance-valid current lock and keeps nested generated paths distinct", async () => {
  const root = await createTestGitFixtureRoot("skillset-lock-read-current-");
  const nested = join(root, "plugins");
  await mkdir(nested, { recursive: true });
  const workspacePath = join(root, "skillset.lock");
  const generatedPath = join(nested, "skillset.lock");
  const nestedLock = withLockProvenance({
    ...currentLock(),
    outputRoot: "plugins",
  });
  await writeFile(workspacePath, JSON.stringify(currentLock()), "utf8");
  await writeFile(generatedPath, JSON.stringify(nestedLock), "utf8");

  await expect(
    readCurrentGeneratedLockFromDisk(workspacePath, {
      expectedOutputRoot: ".",
      logicalPath: "skillset.lock",
    })
  ).resolves.toMatchObject({
    kind: "present",
    lock: { outputRoot: ".", schemaVersion: 4 },
  });
  await expect(
    readCurrentGeneratedLockFromDisk(generatedPath, {
      expectedOutputRoot: "plugins",
      logicalPath: "plugins/skillset.lock",
    })
  ).resolves.toMatchObject({
    kind: "present",
    lock: { outputRoot: "plugins", schemaVersion: 4 },
  });
  await expect(
    readCurrentGeneratedLockFromDisk(generatedPath, {
      logicalPath: "plugins/skillset.lock",
      readText: async () => {
        throw errno("EACCES");
      },
    })
  ).rejects.toThrow(
    "generated lock plugins/skillset.lock cannot guard generated state because it cannot be read (EACCES)"
  );
  await expect(
    readCurrentGeneratedLockFromDisk(generatedPath, {
      logicalPath: "plugins/skillset.lock",
      readText: async () => {
        throw errno("EACCES");
      },
    })
  ).rejects.toThrow("Fix or remove the lock before running build, check, or diff.");
});

test("legacy inspection remains explicit for pre-v4 locks", async () => {
  const root = await createTestGitFixtureRoot("skillset-lock-read-legacy-");
  const path = join(root, "skillset.lock");
  await writeFile(path, JSON.stringify(emptyV2Lock), "utf8");

  await expect(
    readCurrentGeneratedLockFromDisk(path, {
      logicalPath: "skillset.lock",
      missing: "absent",
    })
  ).rejects.toThrow(
    "uses pre-v4 schema 2; this generated state is rebuild-only"
  );
  await expect(
    readLegacyGeneratedLockFromDisk(path, {
      logicalPath: "skillset.lock",
      provenance: "inspect",
    })
  ).resolves.toMatchObject({
    kind: "present",
    lock: { outputRoot: ".", schemaVersion: 2 },
  });
  await expect(
    readInspectableGeneratedLockFromDisk(path, {
      logicalPath: "skillset.lock",
      provenance: "inspect",
    })
  ).resolves.toMatchObject({
    kind: "present",
    lock: { schemaVersion: 2 },
  });
});

test("marketplace state keeps empty-v2 inspection explicit and fails closed on corrupt JSON", async () => {
  const root = await createTestGitFixtureRoot("skillset-lock-read-marketplace-");
  await expect(readExistingMarketplaceState(liveRenderDestination(root))).resolves.toEqual({
    activeCatalogs: {},
    entries: [],
  });
  await writeFile(
    join(root, "skillset.lock"),
    JSON.stringify({
      ...emptyV2Lock,
      marketplaces: {
        activeCatalogs: { claude: "outfitter" },
        entries: [],
      },
    }),
    "utf8"
  );

  await expect(readExistingMarketplaceState(liveRenderDestination(root))).resolves.toEqual({
    activeCatalogs: { claude: "outfitter" },
    entries: [],
  });

  await writeFile(join(root, "skillset.lock"), "{ not valid json", "utf8");
  await expect(readExistingMarketplaceState(liveRenderDestination(root))).rejects.toThrow(
    "workspace lock skillset.lock cannot guard generated state because it is not valid JSON"
  );
});
