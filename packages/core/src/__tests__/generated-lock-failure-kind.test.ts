import { expect, test } from "bun:test";

import {
  parseCurrentLockOrCorrupt,
  parseLegacyLockOrCorrupt,
  readCurrentGeneratedLockFromDisk,
} from "../generated-lock-read";
import { OnDiskJsonError } from "../on-disk-json";

const options = {
  logicalPath: "skillset.lock",
  provenance: "inspect" as const,
};
const lock = () => ({
  schemaVersion: 4,
  generatedBy: "skillset@0.1.0",
  outputRoot: ".",
  target: "workspace",
  selectedTargets: [],
  selectedStandards: [],
  standardProfileEvidence: {},
  items: [],
});

async function caught(action: () => unknown): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to reject");
}

test("lock JSON corruption retains its parse cause and explicit kind", async () => {
  const error = await caught(() =>
    readCurrentGeneratedLockFromDisk("/fixture/skillset.lock", {
      ...options,
      readText: async () => "{",
    })
  );
  expect(error).toMatchObject({
    kind: "invalid-json",
    logicalPath: "skillset.lock",
    path: "/fixture/skillset.lock",
  });
  expect((error as Error).cause).toBeInstanceOf(OnDiskJsonError);
  expect(
    ((error as Error).cause as OnDiskJsonError).failure.cause
  ).toBeInstanceOf(SyntaxError);
});

test.each(["EACCES", "EIO", "ENOENT", undefined])(
  "lock read failure %s remains distinct from corruption",
  async (code) => {
    const original = Object.assign(
      new TypeError("read failed"),
      code === undefined ? {} : { code }
    );
    const error = await caught(() =>
      readCurrentGeneratedLockFromDisk("/fixture/skillset.lock", {
        ...options,
        readText: async () => {
          throw original;
        },
      })
    );
    expect(error).toMatchObject({
      kind: code === "ENOENT" ? "missing" : "unreadable",
      logicalPath: "skillset.lock",
      path: "/fixture/skillset.lock",
    });
    expect((error as Error).cause).toBeInstanceOf(OnDiskJsonError);
    expect(((error as Error).cause as OnDiskJsonError).failure.cause).toBe(
      original
    );
    if (code !== undefined) expect(error).toMatchObject({ code });
  }
);

test.each([parseCurrentLockOrCorrupt, parseLegacyLockOrCorrupt])(
  "schema and expected-root failures carry explicit kinds",
  async (parse) => {
    expect(await caught(() => parse([], options))).toMatchObject({
      kind: "schema",
      logicalPath: "skillset.lock",
    });
    expect(
      await caught(() =>
        parse(lock(), { ...options, expectedOutputRoot: "plugins" })
      )
    ).toMatchObject({ kind: "schema", logicalPath: "skillset.lock" });
    expect(parse(lock(), options).outputRoot).toBe(".");
  }
);

test.each([parseCurrentLockOrCorrupt, parseLegacyLockOrCorrupt])(
  "unknown parser errors are never labeled corrupt input",
  async (parse) => {
    for (const original of [
      new TypeError("internal parser failure"),
      new Error(
        "skillset: workspace lock skillset.lock cannot guard generated state because fake"
      ),
    ]) {
      const value = Object.defineProperty(lock(), "generatedBy", {
        get() {
          throw original;
        },
      });
      expect(await caught(() => parse(value, options))).toBe(original);
    }
  }
);

test("nested result validation retains causes while unexpected faults propagate", async () => {
  const invalid = { ...lock(), renderResults: [{}] };
  const error = await caught(() => parseCurrentLockOrCorrupt(invalid, options));
  expect(error).toMatchObject({ kind: "schema" });
  expect(((error as Error).cause as Error).cause).toBeInstanceOf(Error);
  const original = new TypeError("nested result parser failure");
  const result = Object.defineProperty({}, "schema", {
    get() {
      throw original;
    },
  });
  expect(
    await caught(() =>
      parseCurrentLockOrCorrupt({ ...lock(), renderResults: [result] }, options)
    )
  ).toBe(original);
});


test("an unexpected JSON conversion fault is not invalid lock JSON", async () => {
  const original = new TypeError("unexpected reader value");
  const value = { toString() { throw original; } };
  const error = await caught(() => readCurrentGeneratedLockFromDisk("/fixture/skillset.lock", {
    ...options,
    readText: async () => value as unknown as string,
  }));
  expect(error).toBe(original);
});
