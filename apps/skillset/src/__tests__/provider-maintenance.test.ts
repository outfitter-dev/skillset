import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA,
  PROVIDER_SCHEMA_SNAPSHOT_SCHEMA,
  hashProviderDestinationFormatSnapshot,
  hashProviderSchemaSnapshot,
  listProviderSchemaSnapshots,
  providerSchemaManualOverlays,
  type ProviderDestinationFormatSnapshot,
  type ProviderJsonSchemaSummary,
  type ProviderSchemaSnapshot,
} from "@skillset/registry";
import { describe, expect, test } from "bun:test";

import {
  renderProviderMaintenanceReport,
  renderProviderSchemaSnapshotsSource,
  runProviderMaintenance,
  type ProviderFetch,
} from "../provider-maintenance";

describe("provider maintainer commands", () => {
  test("SET-191: check reports live schema hash and summary drift", async () => {
    const adoptedBody = schemaBody(["alpha"]);
    const liveBody = schemaBody(["alpha", "beta"]);
    const snapshot = schemaSnapshot(adoptedBody, "https://example.com/schema.json");

    const report = await runProviderMaintenance("/tmp/skillset-provider-check", "check", {
      destinationSnapshots: [],
      fetcher: fetchMap({ "https://example.com/schema.json": liveBody }),
      now: "2026-06-23T12:00:00.000Z",
      schemaSnapshots: [snapshot],
    });

    expect(report.ok).toBe(false);
    expect(report.schemaChanged).toBe(1);
    expect(report.schemaMatched).toBe(0);
    expect(report.schemaResults[0]?.summaryChanges).toContain("properties added: beta");
    expect(renderProviderMaintenanceReport(report)).toContain("schema codex-hooks-schema: changed");
  });

  test("SET-191: update writes refreshed schema snapshots only after explicit write", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-providers-"));
    const schemaPath = join(root, "schema-snapshots.ts");
    const adoptedBody = schemaBody(["alpha"]);
    const liveBody = schemaBody(["alpha", "beta"]);
    const snapshot = schemaSnapshot(adoptedBody, "https://example.com/schema.json");

    const preview = await runProviderMaintenance(root, "update", {
      destinationSnapshots: [],
      fetcher: fetchMap({ "https://example.com/schema.json": liveBody }),
      now: "2026-06-23T12:00:00.000Z",
      schemaSnapshotPath: schemaPath,
      schemaSnapshots: [snapshot],
      write: false,
    });

    expect(preview.ok).toBe(true);
    expect(preview.wrote).toBe(false);

    const written = await runProviderMaintenance(root, "update", {
      destinationSnapshots: [],
      fetcher: fetchMap({ "https://example.com/schema.json": liveBody }),
      now: "2026-06-23T12:00:00.000Z",
      schemaSnapshotPath: schemaPath,
      schemaSnapshots: [snapshot],
      write: true,
    });

    expect(written.wrote).toBe(true);
    const source = await readFile(schemaPath, "utf8");
    expect(source).toContain('"beta"');
    expect(source).toContain(hashText(liveBody));
    expect(source).toContain("2026-06-23T12:00:00.000Z");
  });

  test("SET-191: update preserves existing fetchedAt by default for deterministic CLI output", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-providers-deterministic-"));
    const firstPath = join(root, "first.ts");
    const secondPath = join(root, "second.ts");
    const adoptedBody = schemaBody(["alpha"]);
    const liveBody = schemaBody(["alpha", "beta"]);
    const snapshot = schemaSnapshot(adoptedBody, "https://example.com/schema.json");
    const fetcher = fetchMap({ "https://example.com/schema.json": liveBody });

    await runProviderMaintenance(root, "update", {
      destinationSnapshots: [],
      fetcher,
      schemaSnapshotPath: firstPath,
      schemaSnapshots: [snapshot],
      write: true,
    });
    await runProviderMaintenance(root, "update", {
      destinationSnapshots: [],
      fetcher,
      schemaSnapshotPath: secondPath,
      schemaSnapshots: [snapshot],
      write: true,
    });

    const first = await readFile(firstPath, "utf8");
    const second = await readFile(secondPath, "utf8");
    expect(second).toBe(first);
    expect(first).toContain("2026-06-22T12:00:00.000Z");
  });

  test("SET-191: diff includes destination format manual-review evidence", async () => {
    const body = schemaBody(["alpha"]);
    const destination = destinationSnapshot();

    const report = await runProviderMaintenance("/tmp/skillset-provider-diff", "diff", {
      destinationSnapshots: [destination],
      fetcher: fetchMap({ "https://example.com/schema.json": body }),
      now: "2026-06-23T12:00:00.000Z",
      schemaSnapshots: [schemaSnapshot(body, "https://example.com/schema.json")],
    });

    expect(report.ok).toBe(true);
    const rendered = renderProviderMaintenanceReport(report);
    expect(rendered).toContain("destination codex-plugin [codex]: manual-review");
    expect(rendered).toContain("no machine-readable upstream baseline is recorded");
    expect(rendered).toContain("https://developers.openai.com/codex/plugins/build");
  });

  test("SET-191: real schema snapshot source rendering stays importable", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-provider-source-"));
    const path = join(root, "schema-snapshots.ts");
    const source = renderProviderSchemaSnapshotsSource(listProviderSchemaSnapshots(), providerSchemaManualOverlays);

    expect(source).toContain("codex-hook-event-schemas");
    expect(source).toContain("providerSchemaManualOverlays");
    expect(source).toContain("hashProviderSchemaSnapshot");
    expect(source).toContain("https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/");
    await writeFile(path, source);
    const imported = await import(pathToFileURL(path).href) as {
      readonly listProviderSchemaSnapshots: () => readonly ProviderSchemaSnapshot[];
    };
    expect(imported.listProviderSchemaSnapshots().length).toBe(listProviderSchemaSnapshots().length);
  });
});

function schemaBody(properties: readonly string[]): string {
  const propertyRecord: Record<string, unknown> = {};
  for (const property of properties) propertyRecord[property] = { type: "string" };
  return `${JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    properties: propertyRecord,
    required: ["alpha"],
    title: "Codex hooks configuration",
    type: "object",
  })}\n`;
}

function schemaSnapshot(body: string, url: string): ProviderSchemaSnapshot {
  const input = {
    destination: "hooks",
    id: "codex-hooks-schema",
    provenance: {
      contentHash: "",
      fetchedAt: "2026-06-22T12:00:00.000Z",
      rollingLatest: true,
      sources: [{ contentHash: hashText(body), url }],
    },
    schema: PROVIDER_SCHEMA_SNAPSHOT_SCHEMA,
    summary: jsonSchemaSummary(JSON.parse(body)),
    target: "codex",
    title: "Codex Hooks JSON Schema",
  } as const satisfies ProviderSchemaSnapshot;
  const contentHash = hashProviderSchemaSnapshot(input);
  return { ...input, provenance: { ...input.provenance, contentHash } };
}

function jsonSchemaSummary(value: unknown): ProviderJsonSchemaSummary {
  const record = value as {
    readonly $schema: string;
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
    readonly title: string;
    readonly type: string;
  };
  return {
    properties: Object.keys(record.properties),
    required: record.required,
    schemaUri: record.$schema,
    title: record.title,
    topLevelType: record.type,
  };
}

function destinationSnapshot(): ProviderDestinationFormatSnapshot {
  const input = {
    destination: "plugin",
    format: {
      manifest: {
        path: ".codex-plugin/plugin.json",
        requiredFields: ["name"],
      },
    },
    id: "codex-plugin",
    provenance: {
      contentHash: "",
      fetchedAt: "2026-06-22T12:00:00.000Z",
      sources: [{ url: "https://developers.openai.com/codex/plugins/build" }],
    },
    schema: PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA,
    target: "codex",
    title: "Codex Plugin Destination Format",
  } as const satisfies ProviderDestinationFormatSnapshot;
  const contentHash = hashProviderDestinationFormatSnapshot(input);
  return { ...input, provenance: { ...input.provenance, contentHash } };
}

function fetchMap(responses: Record<string, string>): ProviderFetch {
  return async (url) => {
    const body = responses[url];
    if (body === undefined) {
      return new Response("missing", { status: 404, statusText: "Not Found" });
    }
    return new Response(body);
  };
}

function hashText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
