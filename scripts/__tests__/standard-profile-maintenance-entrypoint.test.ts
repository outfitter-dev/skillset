import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { renderStandardProfileMaintenanceReport } from "../standard-profile-maintenance";

test("SET-397: standard profile maintenance remains explicit and report-only", async () => {
  const root = join(import.meta.dir, "../..");
  const pkg = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  ) as {
    readonly scripts: Readonly<Record<string, string>>;
  };

  expect(pkg.scripts["standards:check"]).toBe(
    "bun scripts/standard-profile-maintenance.ts check"
  );
  expect(pkg.scripts["standards:diff"]).toBe(
    "bun scripts/standard-profile-maintenance.ts diff"
  );
  expect(pkg.scripts["standards:update"]).toBe(
    "bun scripts/standard-profile-maintenance.ts update"
  );
  expect(
    renderStandardProfileMaintenanceReport({
      changed: 1,
      command: "update",
      errors: 0,
      ok: true,
      results: [
        {
          id: "agent-plugins-1.0",
          lifecycle: "candidate",
          snapshots: [
            {
              actualHash: "sha256:next",
              expectedHash: "sha256:previous",
              kind: "schema",
              status: "changed",
              url: "https://example.com/plugin.schema.json",
            },
          ],
          status: "changed",
          title: "Agent Plugins 1.0",
        },
      ],
      wrote: false,
    })
  ).toBe(
    "skillset: standard update checked 1 profiles\n" +
      "  ~ agent-plugins-1.0: changed\n" +
      "    https://example.com/plugin.schema.json sha256:previous -> sha256:next\n" +
      "skillset: 0 matched, 1 changed, 0 failed; snapshots were not adopted\n"
  );
});

test("SET-397: maintenance reports each current source failure", () => {
  for (const command of ["check", "diff", "update"] as const) {
    expect(
      renderStandardProfileMaintenanceReport({
        changed: 0,
        command,
        errors: 1,
        ok: false,
        results: [
          {
            id: "agent-instructions",
            lifecycle: "candidate",
            snapshots: [
              {
                error: "failed to fetch source: 503 Unavailable",
                expectedHash: "sha256:previous",
                kind: "specification",
                status: "error",
                url: "https://raw.example.com/main/AGENTS.md",
              },
            ],
            status: "error",
            title: "Agent Instructions",
          },
        ],
        wrote: false,
      })
    ).toContain(
      "    https://raw.example.com/main/AGENTS.md: failed to fetch source: 503 Unavailable"
    );
  }
});
