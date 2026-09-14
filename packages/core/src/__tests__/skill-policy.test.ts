import { describe, expect, it } from "bun:test";

import { readAllowedTools } from "../skill-policy";

describe("allowed_tools target maps", () => {
  it("requires an explicit agents map member for Agent Skills advisory metadata", () => {
    expect(readAllowedTools({ allowed_tools: "Read" }, "agents", "skill")).toBeUndefined();
    expect(readAllowedTools({ allowed_tools: { agents: "Read" } }, "agents", "skill")).toEqual(["Read"]);
    expect(readAllowedTools({ allowed_tools: { agents: ["Read", "Search"] } }, "agents", "skill")).toEqual([
      "Read",
      "Search",
    ]);
    expect(readAllowedTools({ allowed_tools: { agents: "Read" } }, "claude", "skill")).toBeUndefined();
  });
});
