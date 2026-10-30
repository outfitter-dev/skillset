import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import {
  defaultTargets,
  readCompileConfig,
  readDistributionConfig,
  readMarketplaceCatalogConfig,
  readOutputConfig,
  readWorkspacePluginsConfig,
  resolveTargets,
  validateConfigDocument,
} from "../config";
import {
  parseRemoteRepositoryReference,
  validateRemoteRepositoryRevision,
} from "../remote-repository-reference";
import { validateSchemaField, validateVersionField } from "../versioning";
import { readSkillsetWorkspaceConfig, resolveRepoCacheKey } from "../xdg";
import { parseMarkdown, parseYamlRecord } from "../yaml";

function caught(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected validation to reject");
}

const invalidCases: readonly [string, () => unknown][] = [
  ["YAML shape", () => parseYamlRecord("[]", "skillset.yaml")],
  ["YAML syntax", () => parseYamlRecord("key: [", "skillset.yaml")],
  ["duplicate YAML", () => parseYamlRecord("key: a\nkey: b", "skillset.yaml")],
  ["frontmatter", () => parseMarkdown("---\nname: demo", "SKILL.md")],
  [
    "compile target",
    () =>
      readCompileConfig({ compile: { targets: ["invalid"] } }, "skillset.yaml"),
  ],
  [
    "compile option",
    () => readCompileConfig({ compile: { build: "invalid" } }, "skillset.yaml"),
  ],
  [
    "plugin use",
    () =>
      readWorkspacePluginsConfig(
        { plugins: { internal_use: 7 } },
        "skillset.yaml"
      ),
  ],
  [
    "provider defaults",
    () =>
      resolveTargets(
        defaultTargets(),
        { defaults: { claude: 4 } },
        "skillset.yaml",
        { allowDefaults: true }
      ),
  ],
  [
    "config schema",
    () =>
      validateConfigDocument({ plugins: 7 }, "skillset.yaml", {
        allowCompile: true,
      }),
  ],
  [
    "fixed root override",
    () => readOutputConfig({ claude: { skills: { path: "other" } } }, {}),
  ],
  [
    "distribution",
    () =>
      readDistributionConfig(
        {
          distributions: {
            demo: {
              from: { target: "claude", selector: "*" },
              to: { kind: "local" },
            },
          },
        },
        "skillset.yaml"
      ),
  ],
  ["remote ref", () => parseRemoteRepositoryReference("not a repository")],
  [
    "remote encoding",
    () => parseRemoteRepositoryReference("https://example.com/%xx"),
  ],
  [
    "remote credentials",
    () =>
      parseRemoteRepositoryReference("https://user:secret@example.com/repo"),
  ],
  [
    "revision",
    () => validateRemoteRepositoryRevision({ kind: "ref", ref: "../bad" }),
  ],
  ["version", () => validateVersionField({ version: "invalid" }, "version")],
  ["schema", () => validateSchemaField({ schema: 999 }, "schema")],
  [
    "workspace native agents",
    () =>
      readSkillsetWorkspaceConfig(
        { workspace: { nativeAgents: false } },
        "skillset.yaml"
      ),
  ],
  [
    "workspace cache key",
    () =>
      readSkillsetWorkspaceConfig(
        { workspace: { cacheKey: "BAD!" } },
        "skillset.yaml"
      ),
  ],
];

test.each(invalidCases)("%s is explicit input validation", (_name, action) => {
  expect(caught(action).name).toBe("InputValidationError");
});

test("nested marketplace validation preserves the remote parser cause", () => {
  const error = caught(() =>
    readMarketplaceCatalogConfig(
      {
        marketplaces: {
          demo: {
            targets: ["claude"],
            plugins: [{ id: "demo", plugin: "demo", repo: "not a repository" }],
          },
        },
      },
      "skillset.yaml"
    )
  );
  expect(error.name).toBe("InputValidationError");
  expect(error.cause).toBeInstanceOf(Error);
  expect((error.cause as Error).name).toBe("InputValidationError");
  expect(error.message).toContain(
    "invalid skillset.yaml.marketplaces.demo.plugins[0].repo"
  );
});

test("runtime context and unexpected record faults stay unclassified", () => {
  expect(
    caught(() => resolveRepoCacheKey({ rootPath: "/", hostName: "fixture" }))
      .name
  ).toBe("Error");
  const original = new TypeError("internal property failure");
  const record = Object.defineProperty({}, "compile", {
    get() {
      throw original;
    },
  });
  expect(caught(() => readCompileConfig(record, "skillset.yaml"))).toBe(
    original
  );
});

test("valid parser and config controls keep their normal values", () => {
  expect(parseYamlRecord("name: demo", "skillset.yaml")).toEqual({
    name: "demo",
  });
  expect(parseYamlRecord("", "skillset.yaml")).toEqual({});
  expect(readCompileConfig({}, "skillset.yaml").build).toBe("updated");
  expect(parseRemoteRepositoryReference("github:owner/repo").canonical).toBe(
    "github:owner/repo"
  );
});

// Process isolation keeps injected dependency faults out of concurrent test files.
function probe(script: string): void {
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(new TextDecoder().decode(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
}

test("unexpected YAML library exceptions preserve identity", () => {
  probe(`import assert from "node:assert/strict";
    import YAML from "yaml";
    import { parseYamlRecord } from "./packages/core/src/yaml.ts";
    for (const original of [new TypeError("internal YAML error"), new RangeError("parser overflow"), "unknown fault"]) {
      YAML.parse = () => { throw original; };
      assert.throws(() => parseYamlRecord("key: value", "skillset.yaml"), error => error === original);
    }`);
});

test("unexpected URL construction failures remain internal through config", () => {
  probe(`import assert from "node:assert/strict";
    import { readMarketplaceCatalogConfig } from "./packages/core/src/config.ts";
    const NativeURL = URL;
    const original = new TypeError("unexpected URL implementation fault");
    globalThis.URL = class extends NativeURL { constructor(...args) { super(...args); throw original; } };
    assert.throws(() => readMarketplaceCatalogConfig({marketplaces:{demo:{targets:["claude"],plugins:[{id:"demo",plugin:"demo",repo:"https://example.com/repo"}]}}}, "skillset.yaml"), error => error === original);`);
});

test("registry and schema implementation failures are not input validation", () => {
  probe(`import assert from "node:assert/strict";
    import { mock } from "bun:test";
    const registry = await import("@skillset/registry");
    const schema = await import("@skillset/schema");
    const original = new TypeError("schema implementation fault");
    mock.module("@skillset/registry", () => ({...registry, listProviderDestinationFormatSnapshots: () => []}));
    mock.module("@skillset/schema", () => ({...schema, validateSingleFileRootConfig: () => { throw original; }}));
    const {readOutputConfig, validateConfigDocument} = await import("./packages/core/src/config.ts");
    assert.throws(() => readOutputConfig({}, {}), error => error.name === "Error" && error.message.includes("skill destination format has no fixed project root"));
    assert.throws(() => validateConfigDocument({}, "skillset.yaml", { allowCompile: true }), error => error === original);`);
});

test("unexpected URI decoding failures preserve identity", () => {
  probe(`import assert from "node:assert/strict";
    import { parseRemoteRepositoryReference } from "./packages/core/src/remote-repository-reference.ts";
    const original = new TypeError("URI decoder implementation fault");
    globalThis.decodeURIComponent = () => { throw original; };
    assert.throws(() => parseRemoteRepositoryReference("https://example.com/repo"), error => error === original);`);
});

test("invalid URI encoding retains the recognized parser cause", () => {
  const error = caught(() =>
    parseRemoteRepositoryReference("https://example.com/%xx")
  );
  expect(error.name).toBe("InputValidationError");
  expect(error.cause).toBeInstanceOf(URIError);
});
