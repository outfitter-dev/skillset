import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { TARGET_NAMES, sourceMetadataContract, validateSourceMetadata } from "../index";

const accepts = new Ajv2020({ allErrors: true, strict: false }).compile(sourceMetadataContract.schema);
for (const target of TARGET_NAMES) {
  for (const value of [42, null, false, [], {}, "", "   "]) test(`rejects malformed plugin output ${target}/${JSON.stringify(value)}`, () => {
    const input = { outputs: { plugins: { [target]: value } } };
    expect(accepts(input)).toBe(false);
    expect(validateSourceMetadata(input).ok).toBe(false);
  });
  test(`accepts typed ${target} path without promising placement`, () => {
    const input = { outputs: { plugins: { [target]: "plugins", extension: 42 }, extension: true } };
    expect(accepts(input)).toBe(true);
    expect(validateSourceMetadata(input).ok).toBe(true);
  });
}
for (const plugins of [42, null, false, [], "plugins"]) test(`rejects malformed plugins map ${JSON.stringify(plugins)}`, () => {
  const input = { outputs: { plugins } };
  expect(accepts(input)).toBe(false);
  expect(validateSourceMetadata(input).ok).toBe(false);
});
test("missing output configuration retains default behavior", () => {
  for (const input of [{}, { outputs: {} }, { outputs: { plugins: {} } }]) {
    expect(accepts(input)).toBe(true);
    expect(validateSourceMetadata(input).ok).toBe(true);
  }
});
