import { describe, expect, test } from "bun:test";

import { parsePushedRefs, refVerdict } from "../pre-push";

const A = "a".repeat(40);
const B = "b".repeat(40);
const ZERO = "0".repeat(40);

describe("parsePushedRefs", () => {
  test("reads one ref per line", () => {
    const input = [
      `refs/heads/one ${A} refs/heads/one ${ZERO}`,
      `refs/heads/two ${B} refs/heads/two ${A}`,
      "",
    ].join("\n");
    expect(parsePushedRefs(input)).toEqual([
      { commit: A, localRef: "refs/heads/one" },
      { commit: B, localRef: "refs/heads/two" },
    ]);
  });

  test("skips deletions and blank input", () => {
    expect(parsePushedRefs(`(delete) ${ZERO} refs/heads/gone ${A}\n`)).toEqual(
      []
    );
    expect(parsePushedRefs("")).toEqual([]);
  });
});

describe("refVerdict", () => {
  test("a receipt verifies any ref", () => {
    expect(refVerdict({ hasReceipt: true, isCleanHead: false })).toBe(
      "verified"
    );
    expect(refVerdict({ hasReceipt: true, isCleanHead: true })).toBe(
      "verified"
    );
  });

  test("only the clean checked-out tree can run the fast tier", () => {
    expect(refVerdict({ hasReceipt: false, isCleanHead: true })).toBe(
      "fast-tier"
    );
    expect(refVerdict({ hasReceipt: false, isCleanHead: false })).toBe(
      "unverified"
    );
  });
});
