import { describe, expect, it } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import {
  pluginConfigContract,
  ROOT_DRAFT_SELECTOR_PATTERN,
  SOURCE_UNIT_SELECTOR_PATTERN,
  skillsetSchemaExamples,
  sourceMetadataContract,
  TARGET_NAMES,
  validatePluginConfig,
  validateSingleFileRootConfig,
  validateSourceMetadata,
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

const cases: Record<string, ParityCase> = {
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
    invalid: [...legacyOutputRoots, { outputs: { skills: "generated/skills" } }],
    valid: [
      example("source-metadata"),
      { outputs: { plugins: { codex: "generated/codex/plugins" } } },
      { outputs: { skills: {} } },
    ],
    validators: [validateSourceMetadata],
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
