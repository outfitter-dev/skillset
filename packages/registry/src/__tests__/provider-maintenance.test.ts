import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createProgram,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
} from "typescript";

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
} from "../index";
import {
  renderProviderSchemaSnapshotsSource,
  runProviderMaintenance,
  type ProviderFetch,
} from "../provider-maintenance";

describe("SET-335 registry-owned provider maintenance", () => {
  test("SET-191: check reports live schema hash and summary drift", async () => {
    const adoptedBody = schemaBody(["alpha"]);
    const liveBody = schemaBody(["alpha", "beta"]);
    const snapshot = schemaSnapshot(
      adoptedBody,
      "https://example.com/schema.json"
    );

    const report = await runProviderMaintenance(
      "/tmp/skillset-provider-check",
      "check",
      {
        destinationSnapshots: [],
        fetcher: fetchMap({ "https://example.com/schema.json": liveBody }),
        now: "2026-06-23T12:00:00.000Z",
        schemaSnapshots: [snapshot],
      }
    );

    expect(report.ok).toBe(false);
    expect(report.schemaChanged).toBe(1);
    expect(report.schemaMatched).toBe(0);
    expect(report.schemaResults[0]?.summaryChanges).toContain(
      "properties added: beta"
    );
  });

  test("SET-191: update writes refreshed schema snapshots only after explicit write", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-providers-"));
    const schemaPath = join(root, "schema-snapshots.ts");
    const adoptedBody = schemaBody(["alpha"]);
    const liveBody = schemaBody(["alpha", "beta"]);
    const snapshot = schemaSnapshot(
      adoptedBody,
      "https://example.com/schema.json"
    );

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
    const root = await mkdtemp(
      join(tmpdir(), "skillset-providers-deterministic-")
    );
    const firstPath = join(root, "first.ts");
    const secondPath = join(root, "second.ts");
    const adoptedBody = schemaBody(["alpha"]);
    const liveBody = schemaBody(["alpha", "beta"]);
    const snapshot = schemaSnapshot(
      adoptedBody,
      "https://example.com/schema.json"
    );
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

  test("SET-335: network failures are actionable and never write snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-providers-error-"));
    const schemaPath = join(root, "schema-snapshots.ts");
    const adoptedBody = schemaBody(["alpha"]);
    const url = "https://example.com/unavailable-schema.json";

    const report = await runProviderMaintenance(root, "update", {
      destinationSnapshots: [],
      fetcher: fetchMap({}),
      now: "2026-06-23T12:00:00.000Z",
      schemaSnapshotPath: schemaPath,
      schemaSnapshots: [schemaSnapshot(adoptedBody, url)],
      write: true,
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toBe(1);
    expect(report.wrote).toBe(false);
    expect(report.schemaResults[0]?.error).toBe(
      `failed to fetch ${url}: 404 Not Found`
    );
    expect(await Bun.file(schemaPath).exists()).toBe(false);
  });

  test("SET-191: diff includes destination format manual-review evidence", async () => {
    const body = schemaBody(["alpha"]);
    const destination = destinationSnapshot();

    const report = await runProviderMaintenance(
      "/tmp/skillset-provider-diff",
      "diff",
      {
        destinationSnapshots: [destination],
        fetcher: fetchMap({ "https://example.com/schema.json": body }),
        now: "2026-06-23T12:00:00.000Z",
        schemaSnapshots: [
          schemaSnapshot(body, "https://example.com/schema.json"),
        ],
      }
    );

    expect(report.ok).toBe(true);
    expect(report.destinationReviews).toEqual([
      {
        contentHash: destination.provenance.contentHash,
        id: "codex-plugin",
        reason:
          "destination format snapshots are adopted from prose docs; no machine-readable upstream baseline is recorded",
        sources: ["https://developers.openai.com/codex/plugins/build"],
        status: "manual-review",
        target: "codex",
        title: "Codex Plugin Destination Format",
      },
    ]);
  });

  test("SET-335: real schema snapshot source rendering is exact and importable", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-provider-source-"));
    const path = join(root, "schema-snapshots.ts");
    const source = renderProviderSchemaSnapshotsSource(
      listProviderSchemaSnapshots(),
      providerSchemaManualOverlays
    );

    expect(
      renderProviderSchemaSnapshotsSource(
        listProviderSchemaSnapshots(),
        providerSchemaManualOverlays
      )
    ).toBe(source);
    const formatSnapshotUnion = source.match(
      /readonly formatSnapshotId:\n([\s\S]*?);\n  readonly id:/u
    )?.[1];
    const expectedFormatSnapshotUnion = [
      ...new Set(
        providerSchemaManualOverlays.map((overlay) => overlay.formatSnapshotId)
      ),
    ]
      .sort()
      .map((id) => `    | ${JSON.stringify(id)}`)
      .join("\n");
    expect(formatSnapshotUnion).toBe(expectedFormatSnapshotUnion);
    expect(formatSnapshotUnion).toContain('| "claude-hooks"');
    expect(hashText(source)).toBe(
      "sha256:340f6aada58c322156cd754f11c3ccc6c3ed1c87e6e3919c8bffae74b3180f52"
    );
    await writeFile(path, source);
    expect(typeDiagnostics(path)).toEqual([]);
    const missingOverlayTypePath = join(
      root,
      "schema-snapshots-missing-overlay-type.ts"
    );
    await writeFile(
      missingOverlayTypePath,
      source.replace('    | "claude-hooks"\n', "")
    );
    expect(
      typeDiagnostics(missingOverlayTypePath).map(({ code }) => code)
    ).toContain(2322);
    const imported = (await import(pathToFileURL(path).href)) as {
      readonly listProviderSchemaSnapshots: () => readonly ProviderSchemaSnapshot[];
    };
    expect(imported.listProviderSchemaSnapshots().length).toBe(
      listProviderSchemaSnapshots().length
    );
  });
});

function schemaBody(properties: readonly string[]): string {
  const propertyRecord: Record<string, unknown> = {};
  for (const property of properties)
    propertyRecord[property] = { type: "string" };
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

function typeDiagnostics(path: string) {
  const program = createProgram([path], {
    exactOptionalPropertyTypes: true,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.Bundler,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    strict: true,
    target: ScriptTarget.ES2023,
    types: ["bun"],
  });
  return getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === path)
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
}
