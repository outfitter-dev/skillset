import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProviderMaintenanceReport } from "../../packages/registry/src/provider-maintenance";
import { renderProviderMaintenanceReport } from "../provider-maintenance";

test("SET-281: provider evidence maintenance is repo-script owned", async () => {
  const root = join(import.meta.dir, "../..");
  const pkg = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  ) as {
    scripts: Record<string, string>;
  };

  expect(pkg.scripts["providers:check"]).toBe(
    "bun scripts/provider-maintenance.ts check"
  );
  expect(pkg.scripts["providers:diff"]).toBe(
    "bun scripts/provider-maintenance.ts diff"
  );
  expect(pkg.scripts["providers:update"]).toBe(
    "bun scripts/provider-maintenance.ts update"
  );

  const child = Bun.spawn(
    [process.execPath, "scripts/provider-maintenance.ts", "bogus"],
    {
      cwd: root,
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toContain(
    "expected provider maintenance command check, diff, or update"
  );

  const ignoredFlag = Bun.spawn(
    [
      process.execPath,
      "scripts/provider-maintenance.ts",
      "update",
      "--dry-run",
    ],
    {
      cwd: root,
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  expect(await ignoredFlag.exited).toBe(1);
  expect(await new Response(ignoredFlag.stderr).text()).toContain(
    "provider maintenance does not accept additional arguments: --dry-run"
  );
});

test("SET-335: provider maintenance terminal reports remain exact", () => {
  const changedResult = {
    id: "codex-hooks-schema",
    snapshotHash: {
      actual: "sha256:next",
      expected: "sha256:previous",
    },
    sources: [
      {
        actualHash: "sha256:source-next",
        expectedHash: "sha256:source-previous",
        status: "changed" as const,
        url: "https://example.com/schema.json",
      },
    ],
    status: "changed" as const,
    summaryChanges: ["properties added: beta"],
    title: "Codex Hooks JSON Schema",
  };
  const destinationReview = {
    contentHash: "sha256:destination",
    id: "codex-plugin",
    reason:
      "destination format snapshots are adopted from prose docs; no machine-readable upstream baseline is recorded",
    sources: ["https://developers.openai.com/codex/plugins/build"],
    status: "manual-review" as const,
    target: "codex",
    title: "Codex Plugin Destination Format",
  };
  const checkReport = {
    command: "check",
    destinationReviews: [],
    errors: 0,
    ok: false,
    schemaChanged: 1,
    schemaMatched: 0,
    schemaPath: "/repo/packages/registry/src/schema-snapshots.ts",
    schemaResults: [changedResult],
    wrote: false,
  } as const satisfies ProviderMaintenanceReport;
  const diffReport = {
    ...checkReport,
    command: "diff",
    destinationReviews: [destinationReview],
    ok: true,
  } as const satisfies ProviderMaintenanceReport;
  const updateReport = {
    command: "update",
    destinationReviews: [],
    errors: 1,
    ok: false,
    schemaChanged: 0,
    schemaMatched: 0,
    schemaPath: "/repo/packages/registry/src/schema-snapshots.ts",
    schemaResults: [
      {
        error: "failed to fetch https://example.com/schema.json: 404 Not Found",
        id: "codex-hooks-schema",
        sources: [
          {
            expectedHash: "sha256:source-previous",
            status: "error",
            url: "https://example.com/schema.json",
          },
        ],
        status: "error",
        summaryChanges: [],
        title: "Codex Hooks JSON Schema",
      },
    ],
    wrote: false,
  } as const satisfies ProviderMaintenanceReport;

  expect(renderProviderMaintenanceReport(checkReport)).toBe(
    "skillset: provider check checked 1 schema snapshots\n" +
      "  ~ schema codex-hooks-schema: changed\n" +
      "    snapshot: sha256:previous -> sha256:next\n" +
      "skillset: 0 matched, 1 changed, 0 failed; 0 destination format snapshots require manual review\n"
  );
  expect(renderProviderMaintenanceReport(diffReport)).toBe(
    "skillset: provider diff checked 1 schema snapshots\n" +
      "  ~ schema codex-hooks-schema: changed\n" +
      "    snapshot: sha256:previous -> sha256:next\n" +
      "    source: https://example.com/schema.json sha256:source-previous -> sha256:source-next\n" +
      "    properties added: beta\n" +
      "skillset: 0 matched, 1 changed, 0 failed; 1 destination format snapshots require manual review\n" +
      "  ? destination codex-plugin [codex]: manual-review sha256:destination\n" +
      "    reason: destination format snapshots are adopted from prose docs; no machine-readable upstream baseline is recorded\n" +
      "    source: https://developers.openai.com/codex/plugins/build\n"
  );
  expect(renderProviderMaintenanceReport(updateReport)).toBe(
    "skillset: provider update checked 1 schema snapshots\n" +
      "  ! schema codex-hooks-schema: error\n" +
      "    error: failed to fetch https://example.com/schema.json: 404 Not Found\n" +
      "    source: https://example.com/schema.json sha256:source-previous -> unavailable\n" +
      "skillset: 0 matched, 0 changed, 1 failed; 0 destination format snapshots require manual review\n" +
      "skillset: provider schema snapshots were not updated because checks failed\n"
  );
});
