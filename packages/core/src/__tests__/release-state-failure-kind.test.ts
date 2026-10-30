import { expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { readReleaseState } from "../release-state";

const createdAt = "2026-10-30T00:00:00.000Z";
const derived = {
  scopes: { "skill:demo": { version: "2.0.0", updatedAt: createdAt } },
};
async function fixture(withLedger: boolean, content?: string) {
  const root = await createTestFixtureRoot("release-cache-errors-");
  const path = join(root, ".skillset/changes/state.json");
  if (withLedger) {
    const event = {
      schemaVersion: 1,
      id: "release-demo",
      type: "release.applied",
      createdAt,
      payload: {
        releaseId: "release-demo",
        reasonIds: ["demo"],
        scopes: [
          {
            selector: "skill:demo",
            bump: "minor",
            entries: ["demo"],
            version: "2.0.0",
          },
        ],
      },
    };
    await Bun.write(
      join(root, ".skillset/changes/ledger.jsonl"),
      JSON.stringify(event) + "\n"
    );
  }
  if (content !== undefined) await Bun.write(path, content);
  return { root, path };
}
async function caught(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}
const malformed = [
  "{",
  "[]",
  JSON.stringify({ schemaVersion: 3, scopes: {} }),
  JSON.stringify({ schemaVersion: 2, sourceMoveCursor: 1, scopes: {} }),
  "{}",
  JSON.stringify({ scopes: [] }),
  JSON.stringify({ scopes: { demo: false } }),
  ...[undefined, "", 1, "bad"].map((version) =>
    JSON.stringify({ scopes: { demo: { version } } })
  ),
  JSON.stringify({ scopes: { demo: { version: "1.0.0", removed: "yes" } } }),
  JSON.stringify({ scopes: { demo: { version: "1.0.0", sourceHash: "bad" } } }),
];
for (const withLedger of [false, true]) {
  test.each(malformed)(
    `ledger=${withLedger} corruption policy for %s`,
    async (content) => {
      const input = await fixture(withLedger, content);
      if (withLedger)
        expect(await readReleaseState(input.root)).toEqual(derived);
      else {
        const error = await caught(() => readReleaseState(input.root));
        expect(error).toMatchObject({ name: "CorruptReleaseStateError" });
        if (content === "{")
          expect((error as Error).cause).toBeInstanceOf(SyntaxError);
      }
    }
  );
  test(`ledger=${withLedger} missing cache and unknown cursor differ`, async () => {
    const missing = await fixture(withLedger);
    expect(await readReleaseState(missing.root)).toEqual(
      withLedger ? derived : { scopes: {} }
    );
    const unknown = await fixture(
      withLedger,
      JSON.stringify({
        schemaVersion: 2,
        sourceMoveCursor: "unknown",
        scopes: {},
      })
    );
    await expect(readReleaseState(unknown.root)).rejects.toThrow(
      "unknown source move cursor unknown"
    );
  });
  test.each(["EACCES", "EIO", "ELOOP", "ENOTDIR", "ENOENT", "internal"])(
    `ledger=${withLedger} preserves read %s`,
    async (code) => {
      const input = await fixture(withLedger, JSON.stringify({ scopes: {} }));
      const result = Bun.spawnSync(
        [
          process.execPath,
          "--eval",
          `
      import assert from "node:assert/strict";
      import {mock} from "bun:test";
      const fs = await import("node:fs/promises");
      const readFile = fs.readFile;
      const original = Object.assign(new TypeError("cache read fault"), ${JSON.stringify(code)} === "internal" ? {} : {code: ${JSON.stringify(code)}});
      mock.module("node:fs/promises", () => ({...fs, readFile: async (path, ...args) => {
        if (path === ${JSON.stringify(input.path)}) throw original;
        return readFile(path, ...args);
      }}));
      const {readReleaseState} = await import("./packages/core/src/release-state.ts");
      await assert.rejects(readReleaseState(${JSON.stringify(input.root)}), error => error === original);
    `,
        ],
        {
          cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      expect(new TextDecoder().decode(result.stderr)).toBe("");
      expect(result.exitCode).toBe(0);
    }
  );
  test(`ledger=${withLedger} unexpected version validator fault escapes`, async () => {
    const input = await fixture(
      withLedger,
      JSON.stringify({ scopes: { "skill:legacy": { version: "1.0.0" } } })
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import assert from "node:assert/strict";
      import {mock} from "bun:test";
      const versioning = await import("./packages/core/src/versioning.ts");
      const original = new TypeError("version validator fault");
      mock.module("./packages/core/src/versioning.ts", () => ({...versioning, validateVersionField: () => {throw original;}}));
      const {readReleaseState} = await import("./packages/core/src/release-state.ts");
      await assert.rejects(readReleaseState(${JSON.stringify(input.root)}), error => error === original);
    `,
      ],
      {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(new TextDecoder().decode(result.stderr)).toBe("");
    expect(result.exitCode).toBe(0);
  });
}

test("valid cache merges legacy scopes and preserves permissive optional fields", async () => {
  const input = await fixture(
    true,
    JSON.stringify({
      scopes: {
        "skill:demo": { version: "1.0.0" },
        "skill:legacy": {
          version: "1.2.0",
          sourceHash: false,
          updatedAt: false,
        },
        "skill:empty": { version: "1.3.0", sourceHash: "", updatedAt: "" },
      },
    })
  );
  expect(await readReleaseState(input.root)).toEqual({
    scopes: {
      ...derived.scopes,
      "skill:legacy": { version: "1.2.0" },
      "skill:empty": { version: "1.3.0" },
    },
  });
});
