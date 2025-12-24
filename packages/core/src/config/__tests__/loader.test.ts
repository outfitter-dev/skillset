import { describe, expect, test } from "bun:test";
import type { ConfigSchema, GeneratedSettingsSchema } from "@skillset/types";
import { hashValue } from "../hash";
import { applyGeneratedOverrides, cleanupStaleHashes } from "../loader";

const baseConfig: ConfigSchema = {
  version: 1,
  rules: { unresolved: "warn", ambiguous: "warn" },
  output: { max_lines: 500, include_layout: false },
  resolution: {
    fuzzy_matching: true,
    default_scope_priority: ["project", "user", "plugin"],
  },
  skills: {},
  sets: {},
};

describe("config loader", () => {
  test("applies generated override when YAML hash matches", () => {
    const yaml: Partial<ConfigSchema> = {
      output: { max_lines: 500, include_layout: false },
    };
    const generated: GeneratedSettingsSchema = {
      _yaml_hashes: {
        "output.max_lines": hashValue(500),
      },
      output: { max_lines: 300 },
      projects: {},
    };

    const base = {
      ...baseConfig,
      output: { ...baseConfig.output, max_lines: 500 },
    };
    const merged = applyGeneratedOverrides(base, yaml, generated);
    expect(merged.output.max_lines).toBe(300);
  });

  test("ignores generated override when YAML has changed", () => {
    const yaml: Partial<ConfigSchema> = {
      output: { max_lines: 600, include_layout: false },
    };
    const generated: GeneratedSettingsSchema = {
      _yaml_hashes: {
        "output.max_lines": hashValue(500),
      },
      output: { max_lines: 300 },
      projects: {},
    };

    const base = {
      ...baseConfig,
      output: { ...baseConfig.output, max_lines: 600 },
    };
    const merged = applyGeneratedOverrides(base, yaml, generated);
    expect(merged.output.max_lines).toBe(600);
  });

  test("cleanupStaleHashes removes overrides for deleted keys", () => {
    const yaml: Partial<ConfigSchema> = {
      output: { include_layout: false },
    };
    const generated: GeneratedSettingsSchema = {
      _yaml_hashes: {
        "output.max_lines": hashValue(500),
      },
      output: { max_lines: 300 },
      projects: {},
    };

    const cleaned = cleanupStaleHashes(generated, yaml) as GeneratedSettingsSchema;
    expect(cleaned._yaml_hashes["output.max_lines"]).toBeUndefined();
  });
});
