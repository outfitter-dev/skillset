import { describe, expect, test } from "bun:test";
import {
  deleteValueAtPath,
  getValueAtPath,
  joinKeyPath,
  setValueAtPath,
  splitKeyPath,
} from "../utils";

describe("config utils", () => {
  test("splitKeyPath respects escaped dots", () => {
    expect(splitKeyPath("skills.tools\\.debug")).toEqual([
      "skills",
      "tools.debug",
    ]);
  });

  test("joinKeyPath escapes dots", () => {
    expect(joinKeyPath(["skills", "tools.debug"])).toBe("skills.tools\\.debug");
  });

  test("get/set/delete value by path", () => {
    const base = { skills: { api: "skill" } };
    const withSet = setValueAtPath(base, "skills.tools\\.debug", {
      skill: "debugging",
      include_full: true,
    });

    expect(getValueAtPath(withSet, "skills.tools\\.debug")).toEqual({
      skill: "debugging",
      include_full: true,
    });

    const cleaned = deleteValueAtPath(withSet, "skills.api");
    expect(getValueAtPath(cleaned, "skills.api")).toBeUndefined();
  });
});
