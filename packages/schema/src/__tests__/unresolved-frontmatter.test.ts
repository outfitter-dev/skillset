import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { skillFrontmatterContract, validateSkillFrontmatter } from "../index";

const validate = new Ajv2020({ strict: false }).compile(skillFrontmatterContract.schema);
for (const [value, expected] of [[undefined, true], [["context", "extra"], true], [[], false], [["context", "context"], false], [[""], false], [[3], false], ["context", false]] as const) {
  test(`unresolved frontmatter descriptor and runtime agree for ${JSON.stringify(value)}`, () => {
    const input = { name: "demo", skillset: value === undefined ? {} : { unresolved_frontmatter: value } };
    expect(validate(input)).toBe(expected);
    expect(validateSkillFrontmatter(input).ok).toBe(expected);
  });
}
