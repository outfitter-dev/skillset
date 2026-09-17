import { describe, expect, test } from "bun:test";

import { resolveInternalUseSelection } from "../internal-use";
import type { InternalUseConfig, SourcePlugin, SourceSkill } from "../types";

function skill(id: string, status: "draft" | "live" = "live"): SourceSkill {
  return { id, status } as SourceSkill;
}

function plugin(id: string, skills: readonly SourceSkill[]): SourcePlugin {
  return {
    discoveredSkills: skills,
    id,
    skills: skills.filter((candidate) => candidate.status !== "draft"),
  } as unknown as SourcePlugin;
}

const inventory = [
  plugin("demo", [skill("proofread"), skill("review"), skill("future", "draft")]),
  plugin("tools", [skill("shell")]),
];

describe("root plugin internal-use resolution", () => {
  test("applies only and override after live selection and same-container pairing", () => {
    const plugins = [
      plugin("demo", [
        skill("paired"),
        skill("paired", "draft"),
        skill("plain"),
        skill("future", "draft"),
      ]),
    ];
    const only = resolveInternalUseSelection(
      { drafts: { demo: "only" }, plugins: ["demo"], skills: {} },
      plugins
    );
    expect(only.skills).toEqual([]);
    expect(only.drafts).toEqual([
      { pluginId: "demo", skillId: "future" },
      { pluginId: "demo", skillId: "paired" },
    ]);
    expect(
      only.decisions.find(
        (decision) => decision.skillId === "paired" && decision.status === "draft"
      )
    ).toMatchObject({
      draftPolicy: "only",
      rule: "plugins.internal_use.plugins: demo",
      selected: true,
    });

    const override = resolveInternalUseSelection(
      { drafts: { demo: "override" }, plugins: false, skills: { demo: true } },
      plugins
    );
    expect(override.skills).toEqual([
      { pluginId: "demo", skillId: "plain" },
    ]);
    expect(override.drafts).toEqual([
      { pluginId: "demo", skillId: "paired" },
    ]);
    expect(override.drafts).not.toContainEqual({
      pluginId: "demo",
      skillId: "future",
    });

    const excluded = resolveInternalUseSelection(
      {
        drafts: { demo: "override" },
        plugins: false,
        skills: { demo: ["!paired"] },
      },
      plugins
    );
    expect(excluded.skills).toEqual([
      { pluginId: "demo", skillId: "plain" },
    ]);
    expect(excluded.drafts).toEqual([]);
  });

  test("is order-independent and lets exclusions win", () => {
    const configs: InternalUseConfig[] = [
      {
        drafts: { demo: ["future"] },
        plugins: ["demo", "tools"],
        skills: { demo: ["review", "!proofread"] },
      },
      {
        drafts: { demo: ["future"] },
        plugins: ["tools", "demo"],
        skills: { demo: ["!proofread", "review"] },
      },
    ];
    const resolved = configs.map((config) => resolveInternalUseSelection(config, inventory));
    expect(resolved[0]).toEqual(resolved[1]);
    expect(resolved[0]?.skills).toEqual([
      { pluginId: "demo", skillId: "review" },
      { pluginId: "tools", skillId: "shell" },
    ]);
    expect(resolved[0]?.drafts).toEqual([
      { pluginId: "demo", skillId: "future" },
    ]);
    expect(
      resolved[0]?.decisions.find(
        (decision) => decision.pluginId === "demo" && decision.skillId === "proofread"
      )
    ).toMatchObject({ rule: "plugins.internal_use.skills.demo: !proofread", selected: false });
  });

  test("supports negative-only selections and whole-plugin exclusion", () => {
    const resolved = resolveInternalUseSelection(
      {
        drafts: {},
        plugins: ["!demo"],
        skills: { demo: true, tools: ["!shell"] },
      },
      inventory
    );
    expect(resolved.pluginIds).toEqual(["tools"]);
    expect(resolved.skills).toEqual([]);
    expect(
      resolved.decisions.find(
        (decision) => decision.pluginId === "demo" && decision.skillId === "review"
      )
    ).toMatchObject({ rule: "plugins.internal_use.plugins: !demo", selected: false });
  });

  test("treats empty plugin, skill, and draft lists as selecting none", () => {
    const noPlugins = resolveInternalUseSelection(
      { drafts: {}, plugins: [], skills: {} },
      inventory
    );
    expect(noPlugins.pluginIds).toEqual([]);
    expect(noPlugins.skills).toEqual([]);

    const noSkills = resolveInternalUseSelection(
      { drafts: { demo: [] }, plugins: false, skills: { demo: [] } },
      inventory
    );
    expect(noSkills.skills).toEqual([]);
    expect(noSkills.drafts).toEqual([]);
    expect(
      noSkills.decisions.find(
        (decision) => decision.pluginId === "demo" && decision.skillId === "review"
      )
    ).toMatchObject({ rule: "plugins.internal_use: omitted", selected: false });
  });

  test("defaults to none and rejects contradictions and unknown ids", () => {
    expect(
      resolveInternalUseSelection(
        { drafts: {}, plugins: false, skills: {} },
        inventory
      ).skills
    ).toEqual([]);
    expect(() =>
      resolveInternalUseSelection(
        { drafts: {}, plugins: ["demo", "!demo"], skills: {} },
        inventory
      )
    ).toThrow("selects and excludes demo");
    expect(() =>
      resolveInternalUseSelection(
        { drafts: {}, plugins: false, skills: { demo: ["missing"] } },
        inventory
      )
    ).toThrow("known ids: proofread, review");
  });
});
