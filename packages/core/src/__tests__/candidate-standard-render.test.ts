/* eslint-disable func-style, no-use-before-define, unicorn/import-style -- Behavioral cases lead the disposable fixture helpers. */
import { describe, expect, test } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listStandardProfiles } from "@skillset/registry";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { renderCandidateStandardProfile } from "../candidate-standard-render";
import type { RenderedFile } from "../types";

describe("candidate standard rendering", () => {
  test.each([
    ["agent-instructions", "AGENTS.md"],
    ["agent-skills", ".agents/skills/review/SKILL.md"],
    ["agent-plugins-1.0", "plugins/demo/agents/plugin.json"],
  ] as const)(
    "renders the %s candidate in memory without provider artifacts",
    async (profileId, expectedPath) => {
      const root = await fixtureRoot();
      const rendered = await renderCandidateStandardProfile(root, profileId, {
        profiles: candidateProfiles(),
      });

      expect(paths(rendered)).toContain(expectedPath);
      expect(paths(rendered).every((path) => ownedBy(profileId, path))).toBe(
        true
      );
      expect(
        paths(rendered).some(
          (path) =>
            path.startsWith(".claude/") ||
            path.startsWith(".cursor/") ||
            path.includes("/chatgpt/")
        )
      ).toBe(false);
      expect(
        paths(rendered).some((path) => path.endsWith("skillset.lock"))
      ).toBe(false);
      await expect(stat(join(root, expectedPath))).rejects.toThrow();
    }
  );

  test("fails when the candidate has no applicable source", async () => {
    const root = await fixtureRoot({ includeSkill: false });

    await expect(
      renderCandidateStandardProfile(root, "agent-skills", {
        profiles: candidateProfiles(),
      })
    ).rejects.toThrow("agent-skills has no applicable skills source");
  });
});

function candidateProfiles() {
  return listStandardProfiles().map(({ adoption: _adoption, ...profile }) => ({
    ...profile,
    lifecycle: "candidate" as const,
  }));
}

function paths(files: readonly RenderedFile[]): readonly string[] {
  return files.map((file) => file.path);
}

function ownedBy(
  profileId: "agent-instructions" | "agent-plugins-1.0" | "agent-skills",
  path: string
): boolean {
  if (profileId === "agent-instructions") {
    return path === "AGENTS.md" || path.endsWith("/AGENTS.md");
  }
  if (profileId === "agent-plugins-1.0") {
    return path.startsWith("plugins/demo/agents/");
  }
  return path.startsWith(".agents/skills/");
}

async function fixtureRoot(
  options: { readonly includeSkill?: boolean } = {}
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-candidate-standard-"));
  const files = normalizeSkillsetFixtureFiles({
    ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
claude: true
codex: true
cursor: true
`,
    ".skillset/rules/project.md": `
---
claude: true
codex: true
cursor: true
---

Follow the project conventions.
`,
    ...(options.includeSkill === false
      ? {}
      : {
          ".skillset/skills/review/SKILL.md": `
---
name: review
description: Review a change.
claude: true
codex: true
cursor: true
---

Review the change.
`,
        }),
    "skillset.yaml": `
skillset:
  name: candidate-standard
compile:
  targets: [claude, codex, cursor]
`,
  });
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      Bun.write(join(root, path), `${content.trim()}\n`)
    )
  );
  return root;
}
