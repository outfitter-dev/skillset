import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { applyWorkspaceTransaction } from "../workspace-transaction";

test("new-file appends fence after reading context and preserve foreign events on rollback", async () => {
  const root = await createTestFixtureRoot("transaction-lease-");
  const order: string[] = [];
  let owned = true;
  await Bun.write(join(root, "source.md"), "before\n");
  try {
    await expect(applyWorkspaceTransaction(root, {
      writes: [{ path: "source.md", content: "after\n" }],
      appends: [{
        path: "events",
        records: () => { order.push("records"); return [{ id: "ours" }]; },
        newFile: {
          current: async () => {
            order.push("read");
            expect(await readFile(join(root, "source.md"), "utf8")).toBe("after\n");
            await mkdir(join(root, "events"), { recursive: true });
            await Bun.write(join(root, "events/foreign.jsonl"), '{"id":"foreign"}\n');
            owned = false;
            return "";
          },
          fileName: () => { order.push("name"); return "ours.jsonl"; },
          assertOwned: async () => {
            order.push("assert");
            if (!owned) throw new Error("lost test lease");
          },
        },
      }],
    })).rejects.toThrow("lost test lease");
    expect(order).toEqual(["read", "records", "name", "assert"]);
    expect(await readFile(join(root, "source.md"), "utf8")).toBe("before\n");
    expect(await readdir(join(root, "events"))).toEqual(["foreign.jsonl"]);
    expect(await readFile(join(root, "events/foreign.jsonl"), "utf8")).toBe('{"id":"foreign"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
