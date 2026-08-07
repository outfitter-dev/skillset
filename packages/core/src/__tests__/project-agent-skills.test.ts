import { describe, expect, test } from "bun:test";

import {
  resolveProjectAgentSkills,
  validateProjectAgentSkills,
} from "../project-agent-skills";
import type {
  BuildGraph,
  JsonRecord,
  ResolvedTarget,
  SourceProjectAgent,
  SourcePlugin,
  StandaloneSkill,
  TargetName,
} from "../types";

const targetRecord = (
  enabled: readonly TargetName[] = ["claude", "codex", "cursor"],
  options: Partial<Record<TargetName, JsonRecord>> = {}
): Record<TargetName, ResolvedTarget> => ({
  claude: {
    enabled: enabled.includes("claude"),
    options: options.claude ?? {},
  },
  codex: {
    enabled: enabled.includes("codex"),
    options: options.codex ?? {},
  },
  cursor: {
    enabled: enabled.includes("cursor"),
    options: options.cursor ?? {},
  },
});

function agent(
  skills: readonly string[],
  options: Partial<Record<TargetName, JsonRecord>> = {}
): SourceProjectAgent {
  return {
    adaptiveHooks: [],
    body: "Review.",
    filename: "reviewer.md",
    frontmatter: { description: "Review.", skills: [...skills] },
    hookAttachments: [],
    name: "reviewer",
    outputName: "reviewer",
    relativePath: "reviewer.md",
    sourcePath: "/repo/.skillset/agents/reviewer.md",
    targets: targetRecord(undefined, options),
  };
}

function skill(id: string, enabled?: readonly TargetName[]): StandaloneSkill {
  return {
    adaptiveHooks: [],
    body: "Body.",
    frontmatter: {},
    hookAttachments: [],
    id,
    metadata: {},
    relativePath: id,
    resources: [],
    sourcePath: `/repo/.skillset/skills/${id}/SKILL.md`,
    targets: targetRecord(enabled),
  };
}

function plugin(id: string, skills: readonly StandaloneSkill[]): SourcePlugin {
  return {
    adaptiveHooks: [],
    configPath: `/repo/.skillset/plugins/${id}/skillset.yaml`,
    dependencies: [],
    features: [],
    hookAttachments: [],
    id,
    metadata: {},
    path: `/repo/.skillset/plugins/${id}`,
    skills,
    targets: targetRecord(),
  };
}

function graph(
  projectAgent: SourceProjectAgent,
  standaloneSkills: readonly StandaloneSkill[],
  plugins: readonly SourcePlugin[] = []
): Pick<
  BuildGraph,
  "plugins" | "projectAgents" | "rootPath" | "standaloneSkills"
> {
  return {
    plugins,
    projectAgents: [projectAgent],
    rootPath: "/repo",
    standaloneSkills,
  };
}

describe("project agent skill references", () => {
  test("resolves standalone and qualified plugin skills with provider names", () => {
    const reviewer = agent(["review-policy", "plugin.tools.skill:release"]);
    const source = graph(
      reviewer,
      [skill("review-policy")],
      [plugin("tools", [skill("release")])]
    );

    expect(resolveProjectAgentSkills(source, reviewer, "claude")).toEqual([
      {
        authored: "review-policy",
        ownership: "managed",
        rendered: "review-policy",
        skillId: "review-policy",
      },
      {
        authored: "plugin.tools.skill:release",
        ownership: "managed",
        pluginId: "tools",
        rendered: "tools:release",
        skillId: "release",
      },
    ]);
    expect(() => validateProjectAgentSkills(source)).not.toThrow();
  });

  test("uses provider-specific skill overrides", () => {
    const reviewer = agent(["shared"], {
      codex: { skills: ["codex-only"] },
    });
    const source = graph(reviewer, [skill("shared"), skill("codex-only")]);

    expect(
      resolveProjectAgentSkills(source, reviewer, "claude")?.map(
        (entry) => entry.authored
      )
    ).toEqual(["shared"]);
    expect(
      resolveProjectAgentSkills(source, reviewer, "codex")?.map(
        (entry) => entry.authored
      )
    ).toEqual(["codex-only"]);
  });

  test("preserves explicit provider-native references without weakening managed validation", () => {
    const reviewer = agent([], {
      claude: {
        model: "fable",
        skills: ["review-policy", { native: "trails" }],
      },
    });
    const source = graph(reviewer, [skill("review-policy")]);

    expect(resolveProjectAgentSkills(source, reviewer, "claude")).toEqual([
      {
        authored: "review-policy",
        ownership: "managed",
        rendered: "review-policy",
        skillId: "review-policy",
      },
      {
        authored: "trails",
        ownership: "provider-native",
        rendered: "trails",
      },
    ]);
    expect(() => validateProjectAgentSkills(source)).not.toThrow();

    const missingManaged = agent([], {
      claude: { skills: ["missing", { native: "trails" }] },
    });
    expect(() =>
      resolveProjectAgentSkills(
        graph(missingManaged, []),
        missingManaged,
        "claude"
      )
    ).toThrow('claude.skills references "missing"');
  });

  test("rejects missing, malformed, and target-disabled references", () => {
    expect(() =>
      validateProjectAgentSkills(graph(agent(["missing"]), []))
    ).toThrow(
      '.skillset/agents/reviewer.md claude.skills references "missing"'
    );
    expect(() =>
      validateProjectAgentSkills(
        graph(agent(["plugin.tools.skill"]), [], [plugin("tools", [])])
      )
    ).toThrow("expected plugin.<plugin>.skill:<skill>");
    expect(() =>
      validateProjectAgentSkills(
        graph(agent(["codex-only"]), [skill("codex-only", ["codex"])])
      )
    ).toThrow("the skill is not enabled for claude");
    expect(() =>
      validateProjectAgentSkills(
        graph(agent([], { claude: { skills: [{ native: "   " }] } }), [])
      )
    ).toThrow("non-blank string without surrounding whitespace");
  });
});
