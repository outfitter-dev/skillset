import { describe, expect, it } from "bun:test";

import {
  validateConfigDocument,
  validateRootSourceManifestDocument,
  validateWorkspaceConfigDocument,
} from "../config";
import type { JsonRecord } from "../types";

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
