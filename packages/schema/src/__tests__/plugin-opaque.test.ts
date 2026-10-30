import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { agentFrontmatterContract, ruleFrontmatterContract, validateAgentFrontmatter, validateRuleFrontmatter, pluginConfigContract, skillFrontmatterContract, TARGET_NAMES, validatePluginConfig, validateSkillFrontmatter, validateWorkspaceConfig, workspaceConfigContract } from "../index";

const pluginSchema = new Ajv2020({ strict: false }).compile(pluginConfigContract.schema);
for (const target of TARGET_NAMES) {
  test(`plugin opaque directories have schema/runtime parity: ${target}`, () => {
    for (const opaque of [[], ["config"], ["config/sub", "messages"]]) {
      const value = { [target]: { opaque } };
      expect(pluginSchema(value)).toBe(true);
      expect(validatePluginConfig(value).ok).toBe(true);
    }
    for (const opaque of [true, "config", [1], [""], ["."], [".."], ["../config"], ["config/../other"], ["config/./other"], ["/config"], ["C:/config"], ["config\\sub"], ["config//sub"], ["config/"], [" config"], ["config "], ["config\0file"], ["config\nfile"], ["config", "config"]]) {
      const value = { [target]: { opaque } };
      expect({ opaque, valid: pluginSchema(value) }).toEqual({ opaque, valid: false });
      expect({ opaque, valid: validatePluginConfig(value).ok }).toEqual({ opaque, valid: false });
    }
  });
  test(`opaque directories are plugin-only: ${target}`, () => {
    const workspace = { [target]: { opaque: ["config"] } };
    const skill = { name: "demo", description: "Example", ...workspace };
    expect(new Ajv2020({ strict: false }).compile(workspaceConfigContract.schema)(workspace)).toBe(false);
    expect(validateWorkspaceConfig(workspace).ok).toBe(false);
    expect(new Ajv2020({ strict: false }).compile(skillFrontmatterContract.schema)(skill)).toBe(false);
    expect(validateSkillFrontmatter(skill).ok).toBe(false);
    expect(new Ajv2020({ strict: false }).compile(agentFrontmatterContract.schema)(skill)).toBe(false);
    expect(validateAgentFrontmatter(skill).ok).toBe(false);
    expect(new Ajv2020({ strict: false }).compile(ruleFrontmatterContract.schema)(skill)).toBe(false);
    expect(validateRuleFrontmatter(skill).ok).toBe(false);
  });
}
