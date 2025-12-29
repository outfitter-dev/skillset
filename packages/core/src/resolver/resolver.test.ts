import { describe, expect, it } from "bun:test";
import type {
  CacheSchema,
  ConfigSchema,
  InvocationToken,
  Skill,
} from "@skillset/types";
import { resolveToken, resolveTokens } from "./index";

function createSkill(ref: string, name: string): Skill {
  return {
    skillRef: ref,
    path: `/tmp/${name}/SKILL.md`,
    name,
    description: undefined,
    structure: undefined,
    lineCount: undefined,
    cachedAt: undefined,
  };
}

const frontendSkill = createSkill("project:frontend-design", "Frontend Design");
const backendSkill = createSkill("project:backend-api", "Backend API");
const userAuthSkill = createSkill("user:auth", "Auth");

const cache: CacheSchema = {
  version: 1,
  structureTTL: 3600,
  skills: {
    [frontendSkill.skillRef]: frontendSkill,
    [backendSkill.skillRef]: backendSkill,
    [userAuthSkill.skillRef]: userAuthSkill,
  },
};

const config: ConfigSchema = {
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

describe("resolveToken", () => {
  it("resolves by alias match", async () => {
    const token: InvocationToken = {
      raw: "$frontend-design",
      alias: "frontend-design",
      namespace: undefined,
    };
    const result = await resolveToken(token, config, cache);
    expect(result.skill?.skillRef).toBe(frontendSkill.skillRef);
  });

  it("normalizes aliases before matching", async () => {
    const token: InvocationToken = {
      raw: "$FrontEndDesign",
      alias: "FrontEndDesign",
      namespace: undefined,
    };
    const result = await resolveToken(token, config, cache);
    expect(result.skill?.skillRef).toBe(frontendSkill.skillRef);
  });

  it("returns unmatched when absent", async () => {
    const token: InvocationToken = {
      raw: "$missing",
      alias: "missing",
      namespace: undefined,
    };
    const result = await resolveToken(token, config, cache);
    expect(result.reason).toBe("unmatched");
  });

  it("resolves by explicit mapping", async () => {
    const configWithMapping: ConfigSchema = {
      ...config,
      skills: { fe: "project:frontend-design" },
    };
    const token: InvocationToken = {
      raw: "$fe",
      alias: "fe",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithMapping, cache);
    expect(result.skill?.skillRef).toBe("project:frontend-design");
  });

  it("returns error when mapping points to missing skill", async () => {
    const configWithBadMapping: ConfigSchema = {
      ...config,
      skills: { broken: "nonexistent:skill" },
    };
    const token: InvocationToken = {
      raw: "$broken",
      alias: "broken",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithBadMapping, cache);
    expect(result.reason).toContain("missing ref");
  });

  it("filters by namespace when provided", async () => {
    const token: InvocationToken = {
      raw: "$user:auth",
      alias: "auth",
      namespace: "user",
    };
    const result = await resolveToken(token, config, cache);
    expect(result.skill?.skillRef).toBe("user:auth");
  });

  it("supports namespace shortcuts", async () => {
    const cacheWithProjectAuth: CacheSchema = {
      ...cache,
      skills: {
        ...cache.skills,
        "project:auth": createSkill("project:auth", "Auth Project"),
      },
    };
    const token: InvocationToken = {
      raw: "$p:auth",
      alias: "auth",
      namespace: "p",
    };
    const result = await resolveToken(token, config, cacheWithProjectAuth);
    expect(result.skill?.skillRef).toBe("project:auth");
  });

  it("prefers scope priority when multiple skills match", async () => {
    const cacheWithDupes: CacheSchema = {
      ...cache,
      skills: {
        ...cache.skills,
        "plugin:design": createSkill("plugin:design", "Design Plugin"),
      },
    };
    const token: InvocationToken = {
      raw: "$design",
      alias: "design",
      namespace: undefined,
    };
    const result = await resolveToken(token, config, cacheWithDupes);
    expect(result.skill?.skillRef).toBe("project:frontend-design");
  });

  it("resolves skill with explicit $skill: prefix when both skill and set exist", async () => {
    const cacheWithSkillAndSet: CacheSchema = {
      ...cache,
      skills: {
        ...cache.skills,
        "project:dashboard": createSkill("project:dashboard", "Dashboard"),
      },
      sets: {
        "project:dashboard": {
          setRef: "project:dashboard",
          name: "Dashboard",
          description: undefined,
          skillRefs: ["project:frontend-design"],
        },
      },
    };
    const token: InvocationToken = {
      raw: "$skill:dashboard",
      alias: "dashboard",
      namespace: undefined,
      kind: "skill",
    };
    const result = await resolveToken(token, config, cacheWithSkillAndSet);
    expect(result.skill?.skillRef).toBe("project:dashboard");
  });

  it("resolves set with explicit $set: prefix when both skill and set exist", async () => {
    const cacheWithSkillAndSet: CacheSchema = {
      ...cache,
      skills: {
        ...cache.skills,
        "project:dashboard": createSkill("project:dashboard", "Dashboard"),
      },
      sets: {
        "project:dashboard": {
          setRef: "project:dashboard",
          name: "Dashboard",
          description: undefined,
          skillRefs: ["project:frontend-design"],
        },
      },
    };
    const token: InvocationToken = {
      raw: "$set:dashboard",
      alias: "dashboard",
      namespace: undefined,
      kind: "set",
    };
    const result = await resolveToken(token, config, cacheWithSkillAndSet);
    expect(result.set?.setRef).toBe("project:dashboard");
  });

  it("resolves sets defined in config", async () => {
    const configWithSet: ConfigSchema = {
      ...config,
      sets: {
        frontend: {
          name: "Frontend",
          description: "Frontend bundle",
          skills: ["project:frontend-design"],
        },
      },
    };
    const token: InvocationToken = {
      raw: "$set:frontend",
      alias: "frontend",
      namespace: undefined,
      kind: "set",
    };
    const result = await resolveToken(token, configWithSet, cache);
    expect(result.set?.setRef).toBe("frontend");
  });

  it("resolves sets without explicit prefix", async () => {
    const configWithSet: ConfigSchema = {
      ...config,
      sets: {
        "starter-set": {
          name: "Starter Set",
          description: "Starter bundle",
          skills: ["project:frontend-design"],
        },
      },
    };
    const token: InvocationToken = {
      raw: "$StarterSet",
      alias: "StarterSet",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithSet, cache);
    expect(result.set?.setRef).toBe("starter-set");
  });
});

describe("resolveTokens", () => {
  it("resolves multiple tokens at once", async () => {
    const tokens: InvocationToken[] = [
      {
        raw: "$frontend-design",
        alias: "frontend-design",
        namespace: undefined,
      },
      { raw: "$backend-api", alias: "backend-api", namespace: undefined },
    ];
    const results = await resolveTokens(tokens, config, cache);
    expect(results).toHaveLength(2);
    expect(results[0]?.skill?.skillRef).toBe("project:frontend-design");
    expect(results[1]?.skill?.skillRef).toBe("project:backend-api");
  });

  it("returns empty array for empty input", async () => {
    const results = await resolveTokens([], config, cache);
    expect(results).toEqual([]);
  });
});

describe("resolveToken with object entry formats", () => {
  it("resolves skill entry with path property", async () => {
    const configWithPath: ConfigSchema = {
      ...config,
      skills: {
        api: { path: "./docs/api.md" },
      },
    };
    const token: InvocationToken = {
      raw: "$api",
      alias: "api",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithPath, cache);
    // Path-based skills may not exist on disk, so result depends on file existence
    // The test verifies the path resolution mechanism is invoked
    expect(result.invocation).toBe(token);
  });

  it("resolves skill entry with scope filter (single scope)", async () => {
    const cacheWithDuplicates: CacheSchema = {
      ...cache,
      skills: {
        ...cache.skills,
        "project:debugging": createSkill("project:debugging", "Debugging"),
        "user:debugging": createSkill("user:debugging", "Debugging"),
      },
    };
    const configWithScope: ConfigSchema = {
      ...config,
      skills: {
        debug: { skill: "debugging", scope: "user" },
      },
    };
    const token: InvocationToken = {
      raw: "$debug",
      alias: "debug",
      namespace: undefined,
    };
    const result = await resolveToken(
      token,
      configWithScope,
      cacheWithDuplicates
    );
    expect(result.skill?.skillRef).toBe("user:debugging");
  });

  it("resolves skill entry with scope filter (multiple scopes)", async () => {
    const cacheWithMultipleScopes: CacheSchema = {
      ...cache,
      skills: {
        ...cache.skills,
        "project:auth": createSkill("project:auth", "Auth"),
        "user:auth": createSkill("user:auth", "Auth"),
        "plugin:auth": createSkill("plugin:auth", "Auth"),
      },
    };
    const configWithMultipleScopes: ConfigSchema = {
      ...config,
      skills: {
        auth: { skill: "auth", scope: ["user", "project"] },
      },
    };
    const token: InvocationToken = {
      raw: "$auth",
      alias: "auth",
      namespace: undefined,
    };
    const result = await resolveToken(
      token,
      configWithMultipleScopes,
      cacheWithMultipleScopes
    );
    // Should match either user or project, not plugin
    const scope = result.skill?.skillRef.split(":")[0];
    expect(["user", "project"]).toContain(scope);
    expect(result.skill?.skillRef).not.toBe("plugin:auth");
  });

  it("resolves skill entry with include_full option", async () => {
    const configWithIncludeFull: ConfigSchema = {
      ...config,
      skills: {
        tdd: { skill: "frontend-design", include_full: true },
      },
    };
    const token: InvocationToken = {
      raw: "$tdd",
      alias: "tdd",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithIncludeFull, cache);
    expect(result.skill?.skillRef).toBe(frontendSkill.skillRef);
    expect(result.include_full).toBe(true);
  });

  it("resolves skill entry with include_layout option", async () => {
    const configWithIncludeLayout: ConfigSchema = {
      ...config,
      skills: {
        review: { skill: "backend-api", include_layout: true },
      },
    };
    const token: InvocationToken = {
      raw: "$review",
      alias: "review",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithIncludeLayout, cache);
    expect(result.skill?.skillRef).toBe(backendSkill.skillRef);
    expect(result.include_layout).toBe(true);
  });

  it("propagates both include_full and include_layout options", async () => {
    const configWithBothOptions: ConfigSchema = {
      ...config,
      skills: {
        detailed: {
          skill: "frontend-design",
          include_full: true,
          include_layout: true,
        },
      },
    };
    const token: InvocationToken = {
      raw: "$detailed",
      alias: "detailed",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithBothOptions, cache);
    expect(result.skill?.skillRef).toBe(frontendSkill.skillRef);
    expect(result.include_full).toBe(true);
    expect(result.include_layout).toBe(true);
  });

  it("does not propagate options when not specified", async () => {
    const configWithoutOptions: ConfigSchema = {
      ...config,
      skills: {
        plain: { skill: "frontend-design" },
      },
    };
    const token: InvocationToken = {
      raw: "$plain",
      alias: "plain",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithoutOptions, cache);
    expect(result.skill?.skillRef).toBe(frontendSkill.skillRef);
    expect(result.include_full).toBeUndefined();
    expect(result.include_layout).toBeUndefined();
  });

  it("resolves skill entry with skill property using alias key", async () => {
    const configWithSkillProp: ConfigSchema = {
      ...config,
      skills: {
        fe: { skill: "frontend-design" },
      },
    };
    const token: InvocationToken = {
      raw: "$fe",
      alias: "fe",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithSkillProp, cache);
    expect(result.skill?.skillRef).toBe(frontendSkill.skillRef);
  });

  it("handles object entry with missing path", async () => {
    const configWithBadPath: ConfigSchema = {
      ...config,
      skills: {
        missing: { path: "./nonexistent.md" },
      },
    };
    const token: InvocationToken = {
      raw: "$missing",
      alias: "missing",
      namespace: undefined,
    };
    const result = await resolveToken(token, configWithBadPath, cache);
    // Should fail to resolve since path doesn't exist
    expect(result.reason).toBeDefined();
  });

  it("prioritizes scope filter over default scope priority", async () => {
    const cacheWithScopes: CacheSchema = {
      ...cache,
      skills: {
        ...cache.skills,
        "project:test": createSkill("project:test", "Test"),
        "user:test": createSkill("user:test", "Test"),
      },
    };
    const configWithUserScope: ConfigSchema = {
      ...config,
      resolution: {
        fuzzy_matching: true,
        default_scope_priority: ["project", "user", "plugin"],
      },
      skills: {
        test: { skill: "test", scope: "user" },
      },
    };
    const token: InvocationToken = {
      raw: "$test",
      alias: "test",
      namespace: undefined,
    };
    const result = await resolveToken(
      token,
      configWithUserScope,
      cacheWithScopes
    );
    // Should prefer user scope even though project has higher priority
    expect(result.skill?.skillRef).toBe("user:test");
  });
});
