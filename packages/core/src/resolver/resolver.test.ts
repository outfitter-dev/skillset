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
  it("resolves by alias match", () => {
    const token: InvocationToken = {
      raw: "$frontend-design",
      alias: "frontend-design",
      namespace: undefined,
    };
    const result = resolveToken(token, config, cache);
    expect(result.skill?.skillRef).toBe(frontendSkill.skillRef);
  });

  it("normalizes aliases before matching", () => {
    const token: InvocationToken = {
      raw: "$FrontEndDesign",
      alias: "FrontEndDesign",
      namespace: undefined,
    };
    const result = resolveToken(token, config, cache);
    expect(result.skill?.skillRef).toBe(frontendSkill.skillRef);
  });

  it("returns unmatched when absent", () => {
    const token: InvocationToken = {
      raw: "$missing",
      alias: "missing",
      namespace: undefined,
    };
    const result = resolveToken(token, config, cache);
    expect(result.reason).toBe("unmatched");
  });

  it("resolves by explicit mapping", () => {
    const configWithMapping: ConfigSchema = {
      ...config,
      skills: { fe: "project:frontend-design" },
    };
    const token: InvocationToken = {
      raw: "$fe",
      alias: "fe",
      namespace: undefined,
    };
    const result = resolveToken(token, configWithMapping, cache);
    expect(result.skill?.skillRef).toBe("project:frontend-design");
  });

  it("returns error when mapping points to missing skill", () => {
    const configWithBadMapping: ConfigSchema = {
      ...config,
      skills: { broken: "nonexistent:skill" },
    };
    const token: InvocationToken = {
      raw: "$broken",
      alias: "broken",
      namespace: undefined,
    };
    const result = resolveToken(token, configWithBadMapping, cache);
    expect(result.reason).toContain("missing ref");
  });

  it("filters by namespace when provided", () => {
    const token: InvocationToken = {
      raw: "$user:auth",
      alias: "auth",
      namespace: "user",
    };
    const result = resolveToken(token, config, cache);
    expect(result.skill?.skillRef).toBe("user:auth");
  });

  it("supports namespace shortcuts", () => {
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
    const result = resolveToken(token, config, cacheWithProjectAuth);
    expect(result.skill?.skillRef).toBe("project:auth");
  });

  it("returns ambiguous when multiple skills match", () => {
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
    const result = resolveToken(token, config, cacheWithDupes);
    expect(result.reason).toBe("ambiguous");
    expect(result.candidates?.length).toBeGreaterThan(1);
  });

  it("resolves skill with explicit $skill: prefix when both skill and set exist", () => {
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
    const result = resolveToken(token, config, cacheWithSkillAndSet);
    expect(result.skill?.skillRef).toBe("project:dashboard");
  });

  it("resolves set with explicit $set: prefix when both skill and set exist", () => {
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
    const result = resolveToken(token, config, cacheWithSkillAndSet);
    expect(result.set?.setRef).toBe("project:dashboard");
  });

  it("resolves sets defined in config", () => {
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
    const result = resolveToken(token, configWithSet, cache);
    expect(result.set?.setRef).toBe("frontend");
  });

  it("resolves sets without explicit prefix", () => {
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
    const result = resolveToken(token, configWithSet, cache);
    expect(result.set?.setRef).toBe("starter-set");
  });
});

describe("resolveTokens", () => {
  it("resolves multiple tokens at once", () => {
    const tokens: InvocationToken[] = [
      {
        raw: "$frontend-design",
        alias: "frontend-design",
        namespace: undefined,
      },
      { raw: "$backend-api", alias: "backend-api", namespace: undefined },
    ];
    const results = resolveTokens(tokens, config, cache);
    expect(results).toHaveLength(2);
    expect(results[0]?.skill?.skillRef).toBe("project:frontend-design");
    expect(results[1]?.skill?.skillRef).toBe("project:backend-api");
  });

  it("returns empty array for empty input", () => {
    const results = resolveTokens([], config, cache);
    expect(results).toEqual([]);
  });
});
