import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";
import {
  OnDiskJsonError,
  readOnDiskJson,
} from "../on-disk-json";

function errno(code: string, message = `${code} failure`): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

test("only ENOENT may mean absence when the caller allows it", async () => {
  const root = await createTestGitFixtureRoot("skillset-on-disk-json-missing-");
  const path = join(root, "missing.json");

  await expect(readOnDiskJson(path, { label: path, missing: "absent" })).resolves.toEqual({
    kind: "absent",
  });
  await expect(readOnDiskJson(path, { label: path, missing: "error" })).rejects.toMatchObject({
    failure: { kind: "missing", path },
    message: `${path} is missing`,
  });
});

test.each(["EACCES", "EIO", "ELOOP"] as const)(
  "does not treat %s as absence",
  async (code) => {
    await expect(
      readOnDiskJson("/tmp/unreadable.json", {
        label: "managed.json",
        missing: "absent",
        readText: async () => {
          throw errno(code);
        },
      })
    ).rejects.toMatchObject({
      failure: { code, kind: "unreadable" },
      message: `managed.json cannot be read (${code}): ${code} failure`,
    });
  }
);

test("invalid JSON names the file and never becomes absence", async () => {
  const root = await createTestGitFixtureRoot("skillset-on-disk-json-corrupt-");
  const path = join(root, "broken.json");
  await writeFile(path, "{ not valid json", "utf8");

  await expect(
    readOnDiskJson(path, { label: path, missing: "absent" })
  ).rejects.toBeInstanceOf(OnDiskJsonError);
  await expect(readOnDiskJson(path, { label: path })).rejects.toThrow(
    `${path} is not valid JSON`
  );
});

test("returns parsed JSON for a present file", async () => {
  const root = await createTestGitFixtureRoot("skillset-on-disk-json-present-");
  const path = join(root, "ok.json");
  await writeFile(path, '{"ok":true}', "utf8");

  await expect(readOnDiskJson(path, { label: path })).resolves.toEqual({
    kind: "present",
    value: { ok: true },
  });
});
