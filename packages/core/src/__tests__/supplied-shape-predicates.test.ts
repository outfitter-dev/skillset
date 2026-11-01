import { expect, test } from "bun:test";
import { isSlug, validateSlug } from "../path";
import { isOutputBackupId, restoreOutputBackup } from "../output-safety";

test("slug predicate preserves the Core format", () => {
  for (const value of ["a", "0", "a-", "a--b", "demo-2"]) {
    expect(isSlug(value)).toBe(true);
    expect(validateSlug(value, "name")).toBe(value);
  }
  for (const value of ["", "-a", "Bad", "a b", "a_b", "é"]) {
    expect(isSlug(value)).toBe(false);
    expect(() => validateSlug(value, "name")).toThrow("lowercase slug");
  }
});

test("backup IDs preserve exact lowercase hex and length boundaries", async () => {
  for (const value of ["deadbeef", "0".repeat(8), "f".repeat(64)]) expect(isOutputBackupId(value)).toBe(true);
  for (const value of ["", "a".repeat(7), "a".repeat(65), "DEADBEEF", "deadbeeg", "../deadbeef"]) {
    expect(isOutputBackupId(value)).toBe(false);
    await expect(restoreOutputBackup("unused", value)).rejects.toThrow("lowercase hex ref");
  }
});
