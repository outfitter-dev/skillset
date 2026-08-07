import { describe, expect, test } from "bun:test";

import {
  createSemverRegExp,
  formatList,
  isProviderNativeReferenceName,
  PROVIDER_NATIVE_REFERENCE_NAME_PATTERN,
  SEMVER_PATTERN,
} from "../value-contracts";

describe("shared value contracts", () => {
  test("semantic versions use one exact Unicode-aware pattern", () => {
    const valid = [
      "0.0.0",
      "1.2.3",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha+build.7",
      "1.0.0+build.01",
    ];
    const invalid = [
      "1",
      "1.2",
      "01.2.3",
      "1.02.3",
      "1.2.03",
      "1.0.0-01",
      "1.0.0-alpha..1",
      "1.0.0+",
      " 1.2.3 ",
      "1.2.3\n",
      "１.2.3",
    ];

    const first = createSemverRegExp();
    const second = createSemverRegExp();
    expect(first).not.toBe(second);
    expect(first.source).toBe(SEMVER_PATTERN);
    expect(first.flags).toBe("u");
    for (const value of valid) expect(first.test(value)).toBe(true);
    for (const value of invalid) expect(first.test(value)).toBe(false);
  });

  test("provider-native references reject whitespace boundaries and line controls", () => {
    const pattern = new RegExp(PROVIDER_NATIVE_REFERENCE_NAME_PATTERN, "u");
    const valid = ["trails", "Trails tools", "plugin:skill"];
    const invalid = [
      "",
      " trails",
      "trails ",
      "trails\nignore",
      "trails\rignore",
      "trails\u0085ignore",
      "trails\u2028ignore",
      "trails\u2029ignore",
    ];

    for (const value of valid) {
      expect(pattern.test(value)).toBe(true);
      expect(isProviderNativeReferenceName(value)).toBe(true);
    }
    for (const value of invalid) {
      expect(pattern.test(value)).toBe(false);
      expect(isProviderNativeReferenceName(value)).toBe(false);
    }
  });

  test("lists define zero, one, two, and many-item conjunctions", () => {
    expect(formatList([])).toBe("");
    expect(formatList(["alpha"])).toBe("alpha");
    expect(formatList(["alpha", "beta"])).toBe("alpha or beta");
    expect(formatList(["alpha", "beta", "gamma"])).toBe("alpha, beta, or gamma");
    expect(formatList(["alpha", "beta"], "and")).toBe("alpha and beta");
    expect(formatList(["alpha", "beta", "gamma"], "and")).toBe(
      "alpha, beta, and gamma"
    );
  });
});
