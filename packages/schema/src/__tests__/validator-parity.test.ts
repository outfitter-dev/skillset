import { describe, expect, it } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import {
  agentFrontmatterContract,
  instructionFrontmatterContract,
  pluginConfigContract,
  ROOT_DRAFT_SELECTOR_PATTERN,
  SOURCE_UNIT_SELECTOR_PATTERN,
  skillFrontmatterContract,
  skillsetSchemaExamples,
  sourceMetadataContract,
  TARGET_NAMES,
  validateAgentFrontmatter,
  validateInstructionFrontmatter,
  validatePluginConfig,
  validateRootSourceManifest,
  validateSingleFileRootConfig,
  validateSkillFrontmatter,
  validateSourceMetadata,
  validateSplitWorkspaceConfig,
  validateWorkspaceConfig,
  workspaceConfigContract,
} from "../index";
import type {
  SchemaJsonRecord,
  SchemaJsonValue,
  SkillsetSchemaContract,
  SkillsetSchemaValidationResult,
} from "../index";

interface ParityCase {
  readonly contract: SkillsetSchemaContract;
  readonly invalid: readonly SchemaJsonRecord[];
  readonly valid: readonly SchemaJsonRecord[];
  readonly validators: readonly ((value: unknown) => SkillsetSchemaValidationResult)[];
}

function example(id: string): SchemaJsonRecord {
  const found = skillsetSchemaExamples.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing schema example ${id}`);
  return found.value;
}

const validSkillSelections = [
  true,
  false,
  ["review"],
  { enabled: true, include: ["review"] },
  { enabled: false },
];
const invalidSkillSelections = [
  "generated/skills",
  [1],
  { path: "generated/skills" },
  { enabled: true, path: "generated/skills" },
  { enabled: "yes" },
  { include: "review" },
];
const targetSkillFixtures = (selections: readonly SchemaJsonValue[]) =>
  TARGET_NAMES.flatMap((target) =>
    selections.map((skills) => ({ [target]: { skills } }))
  );
const legacyOutputRoots = TARGET_NAMES.map((target) => ({
  outputs: { skills: { [target]: `generated/${target}/skills` } },
}));

const configFixtures = {
  invalid: [
    ...targetSkillFixtures(invalidSkillSelections),
    ...legacyOutputRoots.map((skillset) => ({ skillset })),
  ],
  valid: [
    ...targetSkillFixtures(validSkillSelections),
    { skillset: { outputs: { plugins: { codex: "generated/codex/plugins" } } } },
  ],
};

const sourceMetadataFixtures = {
  invalid: [...legacyOutputRoots, { outputs: { skills: "generated/skills" } }],
  valid: [
    { outputs: { plugins: { codex: "generated/codex/plugins" } } },
    { outputs: { skills: {} } },
  ],
};
const withSkillset = (base: SchemaJsonRecord) => ({
  invalid: sourceMetadataFixtures.invalid.map((skillset) => ({ ...base, skillset })),
  valid: sourceMetadataFixtures.valid.map((skillset) => ({ ...base, skillset })),
});
// Documents whose `skillset` block routes through the shared source-metadata check.
const skillsetBlockCase = (
  contract: SkillsetSchemaContract,
  validator: (value: unknown) => SkillsetSchemaValidationResult,
  base: SchemaJsonRecord
): ParityCase => ({ contract, ...withSkillset(base), validators: [validator] });
const skillsetBlockCases: Record<string, ParityCase> = {
  "agent frontmatter": skillsetBlockCase(agentFrontmatterContract, validateAgentFrontmatter, {
    description: "Reviews code.",
  }),
  "instruction frontmatter": skillsetBlockCase(
    instructionFrontmatterContract,
    validateInstructionFrontmatter,
    { description: "Review rules." }
  ),
  "skill frontmatter": skillsetBlockCase(skillFrontmatterContract, validateSkillFrontmatter, {
    description: "Reviews code.",
    name: "review",
  }),
  // The split root manifest is the `skillset`/`dependencies`/`supports` subset of the root config schema.
  "split root source manifest": skillsetBlockCase(
    workspaceConfigContract,
    validateRootSourceManifest,
    {}
  ),
};

const cases: Record<string, ParityCase> = {
  ...skillsetBlockCases,
  "plugin config": {
    contract: pluginConfigContract,
    invalid: configFixtures.invalid,
    valid: [example("plugin-config"), ...configFixtures.valid],
    validators: [validatePluginConfig],
  },
  "single-file root config": {
    contract: workspaceConfigContract,
    invalid: [
      ...configFixtures.invalid,
      { drafts: ["plugin.my.plugin.skill:review"] },
      { drafts: ["plugin.my_plugin.skill:review"] },
      { drafts: ["plugin.-demo.skill:review"] },
    ],
    valid: [
      example("workspace-config"),
      ...configFixtures.valid,
      { drafts: ["skill:standalone", "plugin.demo.skill:future", "plugin.demo-kit.skill:future"] },
    ],
    validators: [validateSingleFileRootConfig, validateWorkspaceConfig],
  },
  "source metadata": {
    contract: sourceMetadataContract,
    invalid: sourceMetadataFixtures.invalid,
    valid: [example("source-metadata"), ...sourceMetadataFixtures.valid],
    validators: [validateSourceMetadata],
  },
  // Split `.skillset/config.yaml` keys are a subset of the root config schema.
  "split workspace config": {
    contract: workspaceConfigContract,
    invalid: targetSkillFixtures(invalidSkillSelections),
    valid: targetSkillFixtures(validSkillSelections),
    validators: [validateSplitWorkspaceConfig],
  },
};

describe("@skillset/schema validator parity", () => {
  for (const [name, { contract, invalid, valid, validators }] of Object.entries(cases)) {
    it(`agrees with the ${name} JSON Schema on every fixture`, () => {
      const ajv = new Ajv2020({ allErrors: true, strict: false }).compile(contract.schema);
      const fixtures = [
        ...valid.map((fixture) => ({ expected: true, fixture })),
        ...invalid.map((fixture) => ({ expected: false, fixture })),
      ];
      for (const { expected, fixture } of fixtures) {
        const label = JSON.stringify(fixture);
        expect({ fixture: label, ok: ajv(fixture) }).toEqual({ fixture: label, ok: expected });
        for (const validate of validators) {
          expect({ fixture: label, ok: validate(fixture).ok }).toEqual({
            fixture: label,
            ok: expected,
          });
        }
      }
    });
  }

  it("limits selector plugin segments to Core's slug plugin ids", () => {
    const sourceUnit = new RegExp(SOURCE_UNIT_SELECTOR_PATTERN, "u");
    const rootDraft = new RegExp(ROOT_DRAFT_SELECTOR_PATTERN, "u");
    for (const selector of ["plugin:demo-kit", "plugin.demo-kit.skill:review", "plugin.demo.config:root"]) {
      expect({ selector, ok: sourceUnit.test(selector) }).toEqual({ selector, ok: true });
    }
    for (const selector of [
      "plugin:my.plugin",
      "plugin:my_plugin",
      "plugin.my.plugin.skill:review",
      "plugin.my_plugin.config:root",
    ]) {
      expect({ selector, ok: sourceUnit.test(selector) }).toEqual({ selector, ok: false });
    }
    expect(rootDraft.test("plugin.demo-kit.skill:review")).toBe(true);
    expect(rootDraft.test("plugin.my.plugin.skill:review")).toBe(false);
    expect(rootDraft.test("plugin.my_plugin.skill:review")).toBe(false);
  });
});
