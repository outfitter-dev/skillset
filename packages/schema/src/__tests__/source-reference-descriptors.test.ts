import { describe, expect, test } from "bun:test";

import {
  skillsetSourceReferenceDescriptors,
  skillsetSourceReferenceExclusions,
} from "../index";

describe("source reference descriptors", () => {
  test("inventory every structured SET-370 source reference surface deterministically", () => {
    expect(skillsetSourceReferenceDescriptors.map((descriptor) => descriptor.id)).toEqual([
      "agent-skills",
      "skill-resource-source",
      "skill-resource-destination",
      "hook-attachment",
      "adaptive-hook-run-script",
      "skill-eval-skill-name",
      "skill-eval-file",
      "internal-plugin-dependency",
    ]);

    expect(skillsetSourceReferenceDescriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contracts: ["agent-frontmatter"],
        id: "agent-skills",
        kind: "source-unit-identity",
        mutationPolicy: "rewrite",
        pathPatterns: ["skills[*]", "claude.skills[*]", "codex.skills[*]", "cursor.skills[*]"],
      }),
      expect.objectContaining({
        id: "skill-resource-source",
        kind: "source-path",
        mutationPolicy: "rewrite",
      }),
      expect.objectContaining({
        id: "skill-resource-destination",
        kind: "generated-destination",
        mutationPolicy: "warning-only",
      }),
      expect.objectContaining({
        id: "hook-attachment",
        pathPatterns: ["hooks.<event>[*]", "hooks.<event>[*].hook"],
      }),
      expect.objectContaining({
        id: "adaptive-hook-run-script",
        pathPatterns: ["run.script", "claude.run.script", "codex.run.script", "cursor.run.script"],
      }),
      expect.objectContaining({
        id: "skill-eval-skill-name",
        pathPatterns: ["skill_name"],
      }),
      expect.objectContaining({
        id: "skill-eval-file",
        pathPatterns: ["evals[*].files[*]"],
      }),
      expect.objectContaining({
        id: "internal-plugin-dependency",
        mutationPolicy: "preserve",
      }),
    ]));
  });

  test("keeps descriptor data deeply immutable and excluded surfaces explicit", () => {
    const agentSkills = skillsetSourceReferenceDescriptors[0];

    expect(Object.isFrozen(skillsetSourceReferenceDescriptors)).toBe(true);
    expect(Object.isFrozen(agentSkills)).toBe(true);
    expect(Object.isFrozen(agentSkills.contracts)).toBe(true);
    expect(Object.isFrozen(agentSkills.notes)).toBe(true);
    expect(Object.isFrozen(agentSkills.pathPatterns)).toBe(true);
    expect(skillsetSourceReferenceExclusions.map((exclusion) => exclusion.id)).toEqual([
      "provider-native-opaque-values",
      "unmarked-prose-and-markdown",
      "append-only-history",
      "workspace-test-declarations",
      "plugin-rename",
    ]);
    expect(skillsetSourceReferenceExclusions.every(Object.isFrozen)).toBe(true);
  });
});
