import { describe, expect, it } from "bun:test";

import { listStandardProfiles } from "@skillset/registry";

import { standardProfileStatuses } from "@skillset/core";

describe("standardProfileStatuses", () => {
  it("keeps registry candidates inactive and maps their inherent scopes", () => {
    const statuses = standardProfileStatuses({
      adopted: ["agent-instructions", "agent-skills", "agent-plugins-1.0"],
      explicitNonAdopted: [],
    });

    expect(statuses).toEqual([
      {
        active: false,
        id: "agent-instructions",
        lifecycle: "candidate",
        scope: "project",
        title: "Agent Instructions",
        version: "unversioned",
      },
      {
        active: false,
        id: "agent-plugins-1.0",
        lifecycle: "candidate",
        scope: "plugins",
        title: "Agent Plugins 1.0",
        version: "1.0.0",
      },
      {
        active: false,
        id: "agent-skills",
        lifecycle: "candidate",
        scope: "repo",
        title: "Agent Skills",
        version: "unversioned",
      },
    ]);
  });

  it("marks only adopted profiles participating in the selected scope active", () => {
    const profiles = listStandardProfiles().map((profile) => ({
      ...profile,
      lifecycle: "adopted" as const,
    }));
    const statuses = standardProfileStatuses(
      {
        adopted: ["agent-instructions", "agent-skills", "agent-plugins-1.0"],
        explicitNonAdopted: [],
      },
      ["project"],
      profiles
    );

    expect(
      statuses.map(({ active, id }) => ({ active, id }))
    ).toEqual([
      { active: true, id: "agent-instructions" },
      { active: false, id: "agent-plugins-1.0" },
      { active: false, id: "agent-skills" },
    ]);
  });
});
