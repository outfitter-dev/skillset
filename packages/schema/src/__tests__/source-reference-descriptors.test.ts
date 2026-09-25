import { describe, expect, test } from "bun:test";

import {
  DISTRIBUTION_SOURCE_SELECTOR_PATTERN,
  PLUGIN_DRAFT_SELECTOR_PATTERN,
  ROOT_DRAFT_SELECTOR_PATTERN,
  skillsetSourceReferenceDescriptors,
  skillsetSourceReferenceExclusions,
} from "../index";

describe("source reference descriptors", () => {
  test("inventory every structured SET-370 source reference surface deterministically", () => {
    expect(skillsetSourceReferenceDescriptors.map((descriptor) => descriptor.id)).toEqual([
      "agent-skills",
      "configured-draft-selector",
      "distribution-source-selector",
      "internal-plugin-selection",
      "pending-change-scope",
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
        acceptedSelectorPatterns: {
          "plugin-config": PLUGIN_DRAFT_SELECTOR_PATTERN,
          "root-source-manifest": ROOT_DRAFT_SELECTOR_PATTERN,
          "workspace-config": ROOT_DRAFT_SELECTOR_PATTERN,
        },
        id: "configured-draft-selector",
        pathPatterns: ["drafts[*]"],
      }),
      expect.objectContaining({
        acceptedSelectorPatterns: {
          "root-source-manifest": DISTRIBUTION_SOURCE_SELECTOR_PATTERN,
          "workspace-config": DISTRIBUTION_SOURCE_SELECTOR_PATTERN,
        },
        id: "distribution-source-selector",
        pathPatterns: ["distributions.<id>.from.selector"],
      }),
      expect.objectContaining({
        contracts: ["change-entry"],
        id: "pending-change-scope",
        mutationPolicy: "rewrite",
        pathPatterns: ["scope", "scope[*]", "scopes", "scopes[*]"],
      }),
      expect.objectContaining({
        id: "internal-plugin-selection",
        pathPatterns: [
          "plugins.internal_use.skills.<plugin>[*]",
          "plugins.internal_use.drafts.<plugin>[*]",
        ],
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
    const prose = skillsetSourceReferenceExclusions.find(
      (exclusion) => exclusion.id === "unmarked-prose-and-markdown"
    );
    expect(prose?.reason).toContain("@{{...}}");
    expect(prose?.reason).not.toContain("{{@...}}");
    expect(skillsetSourceReferenceExclusions.every(Object.isFrozen)).toBe(true);
  });
});
