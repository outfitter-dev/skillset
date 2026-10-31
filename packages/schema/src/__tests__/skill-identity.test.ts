import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { skillFrontmatterContract, validateSkillFrontmatter, validatePluginConfig, validateSourceMetadata, validateAgentFrontmatter, validateRuleFrontmatter } from "../index";

const accepts = new Ajv2020({ allErrors: true, strict: false }).compile(skillFrontmatterContract.schema);
for (const field of ["name", "version"] as const) test(`skill ${field} is owned by top-level frontmatter in both schema and validation`, () => {
  for (const value of ["1.0.0", null, 42]) {
    const input = { name: "demo", description: "A useful skill", skillset: { [field]: value } };
    expect(accepts(input)).toBe(false);
    expect(validateSkillFrontmatter(input).diagnostics).toContainEqual({
      code: "schema/skill-frontmatter/metadata-identity",
      path: `$.skillset.${field}`,
      message: `skillset.${field} is unsupported in skills; use top-level ${field}`,
    });
  }
});
test("retains top-level skill identity and descriptive metadata", () => {
  const input = { name: "demo", version: "1.0.0", description: "Useful skill", skillset: { summary: "Short summary", schema: 1 } };
  expect(accepts(input)).toBe(true);
  expect(validateSkillFrontmatter(input).diagnostics).toEqual([]);
});
test("does not infer an identity restriction for other metadata contexts", () => {
  const skillset = { name: "demo", version: "1.0.0" };
  expect(validateSourceMetadata(skillset).diagnostics).toEqual([]);
  expect(validatePluginConfig({ skillset }).diagnostics).toEqual([]);
  expect(validateAgentFrontmatter({ description: "Useful agent", skillset }).diagnostics).toEqual([]);
  expect(validateRuleFrontmatter({ skillset }).diagnostics).toEqual([]);
});
