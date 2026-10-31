import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { readOutputConfig } from "../config";
import { InputValidationError } from "../input-validation-error";
import { loadBuildGraph } from "../resolver";
import { targetNames } from "../targets";

for (const target of targetNames()) test(`output reader rejects malformed ${target} instead of defaulting`, () => {
  for (const value of [42, null, false, [], {}, "", "   "]) {
    expect(() => readOutputConfig({}, { outputs: { plugins: { [target]: value } } })).toThrow(InputValidationError);
  }
  expect(readOutputConfig({}, {}).plugins[target]).toBe("plugins");
  expect(readOutputConfig({}, { outputs: { plugins: { [target]: " plugins " } } }).plugins[target]).toBe("plugins");
});
test("graph rejects malformed source output and retains shared-package placement guard", async () => {
  const root = await createTestFixtureRoot("plugin-output-paths-");
  await mkdir(join(root, ".skillset/plugins/demo/skills/demo"), { recursive: true });
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n");
  await Bun.write(join(root, ".skillset/plugins/demo/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo skill.\n---\nUseful content.\n");
  for (const value of ["42", "other-plugins", "plugins"]) {
    await Bun.write(join(root, "skillset.yaml"), `compile:\n  targets: [codex]\nskillset:\n  outputs:\n    plugins:\n      codex: ${value}\n`);
    if (value === "42") await expect(loadBuildGraph(root)).rejects.toBeInstanceOf(InputValidationError);
    else if (value === "other-plugins") await expect(loadBuildGraph(root)).rejects.toThrow("custom package placement is not yet supported");
    else expect((await loadBuildGraph(root)).root.outputs.plugins.codex).toBe("plugins");
  }
});
