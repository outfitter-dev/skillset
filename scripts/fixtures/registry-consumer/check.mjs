import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { hooks } from "@skillset/registry/hooks";

const require = createRequire(import.meta.url);
const packedJson = (file) =>
  JSON.parse(
    readFileSync(require.resolve(`@skillset/registry/${file}`), "utf-8")
  );

assert.deepEqual(hooks, packedJson("hooks.json"));
assert.equal(
  packedJson("hooks.schema.json").properties.schemaVersion.const,
  hooks.schemaVersion
);
assert.equal(
  hooks.events.UserPromptSubmit.providers.cursor.nativeName,
  "beforeSubmitPrompt"
);
assert.equal(hooks.events["not-a-recorded-event"], undefined);

const blockedPaths = [
  "",
  "/dist/hooks.js",
  "/dist/hooks.json",
  "/provider-validation",
  "/src/index.ts",
];
// Bun resolves package metadata even when the exports map omits it.
if (!process.versions.bun) {
  blockedPaths.push("/package.json");
}
await Promise.all(
  blockedPaths.map((path) => {
    const specifier = `@skillset/registry${path}`;
    return assert.rejects(
      () => import(specifier),
      `${specifier} must not resolve`
    );
  })
);
