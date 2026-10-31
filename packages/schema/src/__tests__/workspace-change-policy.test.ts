import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { validateWorkspaceConfig, workspaceConfigContract, validatePluginConfig } from "../index";

const accepts = new Ajv2020({ allErrors: true, strict: false }).compile(workspaceConfigContract.schema);
for (const changes of [null, [], "policy", { reason: null }, { reason: [] }, { reason: "policy" }, ...["2", 0, -1, 1.5, null, true].map(minLength => ({ reason: { minLength } }))]) {
  test(`rejects malformed workspace change policy ${JSON.stringify(changes)}`, () => {
    const config = { changes };
    expect(accepts(config)).toBe(false);
    expect(validateWorkspaceConfig(config).ok).toBe(false);
  });
}
for (const config of [{}, { changes: {} }, { changes: { reason: {} } }, { changes: { extra: true, reason: { extra: true, minLength: 1 } } }, { changes: { reason: { minLength: 40 } } }]) {
  test(`retains defaults, positive minimum and open extensions ${JSON.stringify(config)}`, () => {
    expect(accepts(config)).toBe(true);
    expect(validateWorkspaceConfig(config).ok).toBe(true);
  });
}
test("does not imply workspace change policy applies to plugins", () => {
  expect(validatePluginConfig({ changes: { reason: { minLength: "uninterpreted" } } }).ok).toBe(true);
});
