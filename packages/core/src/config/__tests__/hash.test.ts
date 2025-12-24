import { describe, expect, test } from "bun:test";
import { hashValue } from "../hash";

describe("config hash", () => {
  test("hash is stable across key order", () => {
    const a = { output: { max_lines: 500, include_layout: false } };
    const b = { output: { include_layout: false, max_lines: 500 } };
    expect(hashValue(a)).toBe(hashValue(b));
  });

  test("hash changes when values change", () => {
    const a = { rules: { unresolved: "warn" } };
    const b = { rules: { unresolved: "error" } };
    expect(hashValue(a)).not.toBe(hashValue(b));
  });
});
