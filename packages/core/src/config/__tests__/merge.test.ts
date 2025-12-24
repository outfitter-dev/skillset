import { describe, expect, test } from "bun:test";
import type { ConfigSchema } from "@skillset/types";
import { mergeConfigs } from "../merge";

describe("config merge", () => {
  test("maps merge by key and arrays replace", () => {
    const base: ConfigSchema = {
      version: 1,
      rules: { unresolved: "warn", ambiguous: "warn" },
      output: { max_lines: 500, include_layout: false },
      resolution: {
        fuzzy_matching: true,
        default_scope_priority: ["project", "user", "plugin"],
      },
      skills: { api: "api" },
      sets: { dev: { name: "Dev", skills: ["api"] } },
    };

    const overlay: Partial<ConfigSchema> = {
      output: { max_lines: 300 },
      skills: { debug: { skill: "debugging" } },
      sets: { dev: { name: "Dev", skills: ["debug"] } },
      ignore_scopes: ["user"],
    };

    const merged = mergeConfigs(base, overlay);

    expect(merged.output.max_lines).toBe(300);
    expect(merged.output.include_layout).toBe(false);
    expect(merged.skills).toEqual({
      api: "api",
      debug: { skill: "debugging" },
    });
    expect(merged.sets?.dev.skills).toEqual(["debug"]);
    expect(merged.ignore_scopes).toEqual(["user"]);
  });
});
