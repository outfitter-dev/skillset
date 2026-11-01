import { describe, expect, it } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import {
  sourceMetadataContract, validateSourceMetadata,
  pluginConfigContract, validatePluginConfig,
  workspaceConfigContract, validateWorkspaceConfig, validateRootSourceManifest,
  skillFrontmatterContract, validateSkillFrontmatter,
  agentFrontmatterContract, validateAgentFrontmatter,
  ruleFrontmatterContract, validateRuleFrontmatter,
} from "../index";
import type { SchemaJsonRecord } from "../index";

// Independent inventory of aliases consumed by Core's compatibility reader.
const strings = [
  "display_name", "displayName", "summary", "short_description", "shortDescription",
  "description", "long_description", "longDescription", "category", "color",
  "brand_color", "brandColor", "website_url", "websiteURL", "privacy_policy_url",
  "privacyPolicyURL", "terms_of_service_url", "termsOfServiceURL", "composer_icon",
  "composerIcon", "logo", "logo_dark", "logoDark",
];
const arrays = ["capabilities", "default_prompt", "defaultPrompt", "screenshots"];
const ajv = new Ajv2020({ allErrors: true, strict: false }).compile(sourceMetadataContract.schema);
const check = (presentation: SchemaJsonRecord, ok: boolean) => {
  const value = { presentation };
  expect({ value, ok: ajv(value) }).toEqual({ value, ok });
  expect({ value, ok: validateSourceMetadata(value).ok }).toEqual({ value, ok });
};

describe("legacy presentation known fields", () => {
  it("validates every scalar alias without narrowing blank compatibility values", () => {
    for (const key of strings) {
      for (const value of ["text", "", " \t\n"]) check({ [key]: value }, true);
      for (const value of [42, false, null, {}, []]) check({ [key]: value }, false);
    }
  });
  it("validates every array alias while preserving empty and blank entries", () => {
    for (const key of arrays) {
      for (const value of [[], [""], [" ", "text", "text"]]) check({ [key]: value }, true);
      for (const value of ["text", 42, null, {}, ["ok", 42]]) check({ [key]: value }, false);
    }
  });
  it("preserves object-level rejection for malformed presentation containers", () => {
    for (const presentation of [null, [], "text", 42]) {
      const value = { presentation };
      expect(ajv(value)).toBe(false);
      expect(validateSourceMetadata(value).diagnostics).toEqual([
        expect.objectContaining({
          code: "schema/source-metadata/presentation",
          path: "$.presentation",
        }),
      ]);
    }
  });
  it("retains unknown extensions and diagnoses malformed shadowed known fields", () => {
    check({ custom: { arbitrary: 42 }, keywords: 42, ui: null }, true);
    const result = validateSourceMetadata({
      listing: { display_name: "Canonical" },
      presentation: { display_name: "First alias", displayName: 42, screenshots: ["ok", 42] },
    });
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "schema/source-metadata/presentation-field", path: "$.presentation.displayName" },
      { code: "schema/source-metadata/presentation-field", path: "$.presentation.screenshots[1]" },
    ]);
  });
  it("applies shared validation in config and each frontmatter consumer", () => {
    for (const [contract, validate, base] of [
      [pluginConfigContract, validatePluginConfig, {}],
      [workspaceConfigContract, validateWorkspaceConfig, validateRootSourceManifest, {}],
      [skillFrontmatterContract, validateSkillFrontmatter, { description: "Skill." }],
      [agentFrontmatterContract, validateAgentFrontmatter, { description: "Agent." }],
      [ruleFrontmatterContract, validateRuleFrontmatter, {}],
    ] as const) {
      const schema = new Ajv2020({ strict: false }).compile(contract.schema);
      for (const [displayName, ok] of [["Valid", true], [42, false]] as const) {
        const value = { ...base, skillset: { presentation: { displayName } } };
        expect({ id: contract.id, ok: schema(value) }).toEqual({ id: contract.id, ok });
        expect({ id: contract.id, ok: validate(value).ok }).toEqual({ id: contract.id, ok });
      }
    }
  });
});
