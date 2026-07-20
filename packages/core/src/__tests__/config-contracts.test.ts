import { describe, expect, it } from "bun:test";

import {
  DISTRIBUTION_RUNTIME_TARGETS,
  NON_DISTRIBUTABLE_RUNTIME_IDS,
  validateConfigDocument,
  validateRootSourceManifestDocument,
  validateWorkspaceConfigDocument,
} from "../config";
import { SKILLSET_RUNTIME_IDS } from "../feature-registry";
import type { JsonRecord } from "../types";

describe("distribution runtime contract", () => {
  it("SET-346 partitions every registered runtime into one target or the named exclusion set", () => {
    const mappedRuntimeIds = Object.values(DISTRIBUTION_RUNTIME_TARGETS).flat();
    const registeredRuntimeIds = new Set<string>(SKILLSET_RUNTIME_IDS);

    for (const runtime of SKILLSET_RUNTIME_IDS) {
      const mappingCount = mappedRuntimeIds.filter((candidate) => candidate === runtime).length;
      const partitionCount = mappingCount + Number(NON_DISTRIBUTABLE_RUNTIME_IDS.has(runtime));

      expect(partitionCount).toBe(1);
    }
    expect(mappedRuntimeIds.filter((runtime) => !registeredRuntimeIds.has(runtime))).toEqual([]);
    expect(
      [...NON_DISTRIBUTABLE_RUNTIME_IDS].filter((runtime) => !registeredRuntimeIds.has(runtime))
    ).toEqual([]);
  });
});

describe("schema-owned config document contexts", () => {
  it("keeps Core validation aligned with each schema-owned document vocabulary", () => {
    expect(() => validateConfigDocument({
      compile: { targets: ["cursor"] },
      skillset: { name: "root" },
      supports: ["bun >=1.0.0"],
    }, "skillset.yaml", { allowCompile: true })).not.toThrow();
    expect(() => validateConfigDocument({ compile: {} }, "unscoped skillset.yaml")).toThrow(
      "unsupported top-level key compile"
    );

    expect(() => validateWorkspaceConfigDocument({ skillset: { name: "wrong-context" } }, ".skillset/config.yaml")).toThrow(
      "unsupported workspace config key skillset"
    );

    expect(() => validateRootSourceManifestDocument({
      skillset: { name: "root" },
      supports: ["bun >=1.0.0"],
    }, ".skillset/skillset.yaml")).not.toThrow();
    expect(() => validateRootSourceManifestDocument({ compile: {} }, ".skillset/skillset.yaml")).toThrow(
      "unsupported root source manifest key compile"
    );

    const plugin: JsonRecord = {
      bin: true,
      hooks: { Stop: ["shell-policy"] },
      mcp: true,
      skillset: { name: "demo" },
    };
    expect(() => validateConfigDocument(plugin, ".skillset/plugins/demo/skillset.yaml", { allowHooks: true })).not.toThrow();
    expect(() => validateConfigDocument({ compile: {} }, ".skillset/plugins/demo/skillset.yaml", { allowHooks: true })).toThrow(
      "unsupported top-level key compile"
    );
  });
});
