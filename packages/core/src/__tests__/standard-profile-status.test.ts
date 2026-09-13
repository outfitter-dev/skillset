import { describe, expect, it } from "bun:test";

import { listStandardProfiles } from "@skillset/registry";

import { standardProfileStatuses } from "@skillset/core";

describe("standardProfileStatuses", () => {
  it("marks adopted registry profiles active and maps their inherent scopes", () => {
    const statuses = standardProfileStatuses({
      adopted: ["agent-instructions", "agent-skills", "agent-plugins-1.0"],
      adoptionReceiptHashes: {},
    });

    expect(statuses).toEqual([
      {
        active: true,
        id: "agent-instructions",
        lifecycle: "adopted",
        scope: "project",
        title: "Agent Instructions",
        version: "unversioned",
      },
      {
        active: true,
        id: "agent-plugins-1.0",
        lifecycle: "adopted",
        scope: "plugins",
        title: "Agent Plugins 1.0",
        version: "1.0.0",
      },
      {
        active: true,
        id: "agent-skills",
        lifecycle: "adopted",
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
        adoptionReceiptHashes: {},
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
