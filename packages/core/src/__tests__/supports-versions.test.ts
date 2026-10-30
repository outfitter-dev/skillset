import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { validateSemverRange, validateSupports } from "../supports";

async function check(version: string, range: string, onMismatch: "warn" | "error" = "error") {
  const rootPath = await createTestFixtureRoot("supports-version-");
  await writeFile(join(rootPath, "package.json"), JSON.stringify({ name: "demo", version }));
  const warnings: string[] = [];
  await validateSupports({ packages: [{ name: "demo", range, source: "repo:package.json", onMismatch }] }, { rootPath, label: "fixture", warnings });
  return warnings;
}

describe("supports version suffix boundaries", () => {
  for (const range of ["=1.0.0-rc.1", "^1.0.0-rc.2", "~1.0.0-alpha", ">=1.0.0-!!!", "=1.0.0+", "1.0.0+ci..1", "1.0.0+ci!", "1.0.0+ci+1"]) {
    test(`rejects unsupported or malformed constraint ${range}`, () => {
      expect(() => validateSemverRange(range, "demo")).toThrow("invalid demo range");
    });
  }

  test("does not accept an observed prerelease as the final release", async () => {
    await expect(check("1.0.0-rc.1", ">=1.0.0")).rejects.toThrow("prerelease");
    const warnings = await check("1.0.0-rc.1", ">=1.0.0", "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("1.0.0-rc.1");
    expect(warnings[0]).toContain("prerelease");
  });

  test("wildcard constraints do not certify unsupported observed versions", async () => {
    await expect(check("1.0.0-rc.1", "*")).rejects.toThrow("prerelease");
    await expect(check("1.0.0+bad!", "*")).rejects.toThrow("semver-like");
    expect(await check("1.0.0+bad!", "*", "warn")).toHaveLength(1);
  });

  test("valid build metadata is checked then ignored for precedence", async () => {
    for (const range of ["=1.0.0+different.002", ">=1.0.0+ci-1", "^1.0.0", "~1.0.0", "*"]) {
      expect(await check("1.0.0+ci-1.001", range)).toEqual([]);
    }
    await expect(check("1.0.1+ci.1", "=1.0.0+ci.1")).rejects.toThrow("supports =1.0.0");
  });

  test("preserves the existing limited release range grammar and mismatch policy", async () => {
    for (const range of [">=2.4 <3", "^2.4.0", "~2.4", "2.4.0", "x"]) {
      expect(await check("2.4.0", range)).toEqual([]);
    }
    expect(await check("3.0.0", "<3", "warn")).toHaveLength(1);
    await expect(check("3.0.0", "<3")).rejects.toThrow("supports <3");
    expect(() => validateSemverRange(">=2 || <3", "demo")).toThrow("OR ranges");
  });
});
