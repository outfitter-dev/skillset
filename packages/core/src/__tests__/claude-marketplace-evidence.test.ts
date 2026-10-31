import { expect, test } from "bun:test";
import { defineFeatureRegistry, getSkillsetFeature, type SkillsetFeatureEntry } from "../feature-registry";

test("SET-488: marketplace support requires the exact evidence target and parent schema", () => {
  const original = getSkillsetFeature("marketplaces")!;
  expect(original.targetSupport.claude.provider?.marketplaceExtensions).toBe("claude-marketplace-extensions");
  for (const provider of [undefined, {}, { marketplaceExtensions: "unknown" },
    { marketplaceExtensions: "claude-marketplace-extensions", schemaSnapshots: ["claude-plugin-manifest-schema"] }]) {
    const changed = { ...original, targetSupport: { ...original.targetSupport, claude: { ...original.targetSupport.claude, provider } } };
    expect(() => defineFeatureRegistry([changed as SkillsetFeatureEntry])).toThrow();
  }
  const wrongTarget = { ...original, targetSupport: { ...original.targetSupport,
    cursor: { ...original.targetSupport.cursor, provider: { marketplaceExtensions: "claude-marketplace-extensions", schemaSnapshots: ["cursor-marketplace-schema"] } },
  } };
  expect(() => defineFeatureRegistry([wrongTarget as SkillsetFeatureEntry])).toThrow();
});
