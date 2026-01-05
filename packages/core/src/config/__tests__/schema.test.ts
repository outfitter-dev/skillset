import { describe, expect, test } from "bun:test";
import { SkillEntrySchema } from "../schema";

describe("SkillEntrySchema", () => {
  test("allows string entries", () => {
    const result = SkillEntrySchema.safeParse("frontend");
    expect(result.success).toBe(true);
  });

  test("allows object entries with skill or path", () => {
    expect(SkillEntrySchema.safeParse({ skill: "frontend" }).success).toBe(
      true
    );
    expect(SkillEntrySchema.safeParse({ path: "./skills/FE.md" }).success).toBe(
      true
    );
  });

  test("allows object entries without skill/path for alias defaults", () => {
    expect(SkillEntrySchema.safeParse({ include_full: true }).success).toBe(
      true
    );
  });

  test("rejects object entries with both skill and path", () => {
    const result = SkillEntrySchema.safeParse({
      skill: "frontend",
      path: "./skills/FE.md",
    });
    expect(result.success).toBe(false);
  });
});
