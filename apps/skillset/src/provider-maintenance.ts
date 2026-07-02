import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  hashProviderSchemaSnapshot,
  listProviderDestinationFormatSnapshots,
  listProviderSchemaSnapshots,
  providerSchemaManualOverlays,
  type ProviderDestinationFormatSnapshot,
  type ProviderJsonSchemaSummary,
  type ProviderSchemaManualOverlay,
  type ProviderSchemaSetEntry,
  type ProviderSchemaSetSummary,
  type ProviderSchemaSnapshot,
  type ProviderSchemaSource,
} from "@skillset/registry";

export type ProviderMaintenanceSubcommand = "check" | "diff" | "update";

export interface ProviderFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  text(): Promise<string>;
}

export type ProviderFetch = (url: string) => Promise<ProviderFetchResponse>;

export interface ProviderMaintenanceOptions {
  readonly destinationSnapshots?: readonly ProviderDestinationFormatSnapshot[];
  readonly fetcher?: ProviderFetch;
  readonly now?: string;
  readonly schemaSnapshotPath?: string;
  readonly schemaSnapshots?: readonly ProviderSchemaSnapshot[];
  readonly write?: boolean;
}

export type ProviderSchemaSnapshotStatus = "changed" | "error" | "matched";

export interface ProviderSchemaSourceCheck {
  readonly actualHash?: string;
  readonly expectedHash: string;
  readonly status: ProviderSchemaSnapshotStatus;
  readonly url: string;
}

export interface ProviderSchemaSnapshotCheck {
  readonly error?: string;
  readonly id: string;
  readonly snapshotHash?: {
    readonly actual: string;
    readonly expected: string;
  };
  readonly sources: readonly ProviderSchemaSourceCheck[];
  readonly status: ProviderSchemaSnapshotStatus;
  readonly summaryChanges: readonly string[];
  readonly title: string;
  readonly updatedSnapshot?: ProviderSchemaSnapshot;
}

export interface ProviderDestinationFormatReview {
  readonly id: string;
  readonly contentHash: string;
  readonly reason: string;
  readonly sources: readonly string[];
  readonly status: "manual-review";
  readonly target: string;
  readonly title: string;
}

export interface ProviderMaintenanceReport {
  readonly command: ProviderMaintenanceSubcommand;
  readonly destinationReviews: readonly ProviderDestinationFormatReview[];
  readonly errors: number;
  readonly ok: boolean;
  readonly schemaChanged: number;
  readonly schemaMatched: number;
  readonly schemaPath: string;
  readonly schemaResults: readonly ProviderSchemaSnapshotCheck[];
  readonly wrote: boolean;
}

export async function runProviderMaintenance(
  rootPath: string,
  command: ProviderMaintenanceSubcommand,
  options: ProviderMaintenanceOptions = {}
): Promise<ProviderMaintenanceReport> {
  const schemaPath = options.schemaSnapshotPath ?? resolve(rootPath, "packages/registry/src/schema-snapshots.ts");
  const schemaSnapshots = options.schemaSnapshots ?? listProviderSchemaSnapshots();
  const destinationSnapshots = options.destinationSnapshots ?? listProviderDestinationFormatSnapshots();
  const fetcher = options.fetcher ?? fetch;
  const fetchedAt = options.now;
  const schemaResults = await Promise.all(
    schemaSnapshots.map((snapshot) => checkSchemaSnapshot(snapshot, fetcher, fetchedAt))
  );
  const errors = schemaResults.filter((result) => result.status === "error").length;
  const schemaChanged = schemaResults.filter((result) => result.status === "changed").length;
  const schemaMatched = schemaResults.filter((result) => result.status === "matched").length;
  let wrote = false;

  if (command === "update" && options.write === true && errors === 0 && schemaChanged > 0) {
    const nextSnapshots = schemaSnapshots.map((snapshot) => {
      const result = schemaResults.find((candidate) => candidate.id === snapshot.id);
      return result?.updatedSnapshot ?? snapshot;
    });
    const source = renderProviderSchemaSnapshotsSource(nextSnapshots, providerSchemaManualOverlays);
    const previous = await readFile(schemaPath, "utf8").catch(() => "");
    if (previous !== source) {
      await writeFile(schemaPath, source);
      wrote = true;
    }
  }

  const ok = command === "check"
    ? errors === 0 && schemaChanged === 0
    : errors === 0;

  return {
    command,
    destinationReviews: destinationSnapshots.map((snapshot) => ({
      contentHash: snapshot.provenance.contentHash,
      id: snapshot.id,
      reason: "destination format snapshots are adopted from prose docs; no machine-readable upstream baseline is recorded",
      sources: snapshot.provenance.sources.map((source) => source.url),
      status: "manual-review",
      target: snapshot.target,
      title: snapshot.title,
    })),
    errors,
    ok,
    schemaChanged,
    schemaMatched,
    schemaPath,
    schemaResults,
    wrote,
  };
}

export function renderProviderMaintenanceReport(report: ProviderMaintenanceReport): string {
  const lines: string[] = [];
  lines.push(`skillset: provider ${report.command} checked ${report.schemaResults.length} schema snapshots`);
  for (const result of report.schemaResults) {
    const marker = result.status === "matched" ? "=" : result.status === "changed" ? "~" : "!";
    lines.push(`  ${marker} schema ${result.id}: ${result.status}`);
    if (result.error !== undefined) lines.push(`    error: ${result.error}`);
    if (result.snapshotHash !== undefined && result.snapshotHash.expected !== result.snapshotHash.actual) {
      lines.push(`    snapshot: ${result.snapshotHash.expected} -> ${result.snapshotHash.actual}`);
    }
    if (report.command !== "check") {
      for (const source of result.sources) {
        const actual = source.actualHash ?? "unavailable";
        if (source.status !== "matched") lines.push(`    source: ${source.url} ${source.expectedHash} -> ${actual}`);
      }
      for (const change of result.summaryChanges) lines.push(`    ${change}`);
    }
  }
  lines.push(
    `skillset: ${report.schemaMatched} matched, ${report.schemaChanged} changed, ${report.errors} failed; ` +
      `${report.destinationReviews.length} destination format snapshots require manual review`
  );
  if (report.command === "diff") {
    for (const review of report.destinationReviews) {
      lines.push(`  ? destination ${review.id} [${review.target}]: ${review.status} ${review.contentHash}`);
      lines.push(`    reason: ${review.reason}`);
      for (const source of review.sources) lines.push(`    source: ${source}`);
    }
  }
  if (report.command === "update") {
    if (report.wrote) {
      lines.push(`skillset: wrote ${report.schemaPath}`);
    } else if (report.schemaChanged > 0 && report.errors === 0) {
      lines.push("skillset: rerun providers update with --yes to refresh schema snapshots");
    } else if (report.errors > 0) {
      lines.push("skillset: provider schema snapshots were not updated because checks failed");
    } else {
      lines.push("skillset: provider schema snapshots are current");
    }
  }
  return `${lines.join("\n")}\n`;
}

async function checkSchemaSnapshot(
  snapshot: ProviderSchemaSnapshot,
  fetcher: ProviderFetch,
  fetchedAt: string | undefined
): Promise<ProviderSchemaSnapshotCheck> {
  try {
    const updated = isProviderSchemaSetSummary(snapshot.summary)
      ? await refreshSchemaSetSnapshot(snapshot, fetcher, fetchedAt)
      : await refreshJsonSchemaSnapshot(snapshot, fetcher, fetchedAt);
    const sources = updated.provenance.sources.map((source, index) => {
      const previous = snapshot.provenance.sources[index];
      return {
        actualHash: source.contentHash,
        expectedHash: previous?.contentHash ?? "",
        status: previous?.contentHash === source.contentHash ? "matched" as const : "changed" as const,
        url: source.url,
      };
    });
    const summaryChanges = summarizeChanges(snapshot.summary, updated.summary);
    const hasContentChanges = sources.some((source) => source.status === "changed") ||
      summaryChanges.length > 0;
    const nextSnapshot = hasContentChanges ? updated : snapshot;
    const snapshotHash = hasContentChanges ? hashProviderSchemaSnapshot(updated) : snapshot.provenance.contentHash;
    const status = hasContentChanges ||
      snapshot.provenance.contentHash !== snapshotHash
      ? "changed"
      : "matched";
    return {
      id: snapshot.id,
      snapshotHash: {
        actual: snapshotHash,
        expected: snapshot.provenance.contentHash,
      },
      sources,
      status,
      summaryChanges,
      title: snapshot.title,
      ...(status === "changed" ? { updatedSnapshot: { ...nextSnapshot, provenance: { ...nextSnapshot.provenance, contentHash: snapshotHash } } } : {}),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      id: snapshot.id,
      sources: snapshot.provenance.sources.map((source) => ({
        expectedHash: source.contentHash,
        status: "error" as const,
        url: source.url,
      })),
      status: "error",
      summaryChanges: [],
      title: snapshot.title,
    };
  }
}

async function refreshJsonSchemaSnapshot(
  snapshot: ProviderSchemaSnapshot,
  fetcher: ProviderFetch,
  fetchedAt: string | undefined
): Promise<ProviderSchemaSnapshot> {
  const fetchedSources = await Promise.all(snapshot.provenance.sources.map((source) => fetchSource(source, fetcher)));
  const primary = fetchedSources[0];
  if (primary === undefined) throw new Error(`provider schema snapshot ${snapshot.id} has no source`);
  const schema = parseJson(primary.text, primary.url);
  const sources = fetchedSources.map((source) => ({
    ...(source.note === undefined ? {} : { note: source.note }),
    contentHash: source.contentHash,
    url: source.url,
  }));
  return {
    ...snapshot,
    provenance: {
      contentHash: snapshot.provenance.contentHash,
      fetchedAt: fetchedAt ?? snapshot.provenance.fetchedAt,
      rollingLatest: true,
      sources,
    },
    summary: summarizeJsonSchema(schema),
  };
}

async function refreshSchemaSetSnapshot(
  snapshot: ProviderSchemaSnapshot,
  fetcher: ProviderFetch,
  fetchedAt: string | undefined
): Promise<ProviderSchemaSnapshot> {
  const [listingSource] = snapshot.provenance.sources;
  if (listingSource === undefined) throw new Error(`provider schema set ${snapshot.id} has no listing source`);
  const listing = await fetchSource(listingSource, fetcher);
  const entries = readGithubDirectoryEntries(parseJson(listing.text, listing.url));
  const schemaEntries = await Promise.all(entries.map(async (entry) => {
    const fetched = await fetchText(entry.url, fetcher);
    const parsed = parseJson(fetched.text, entry.url);
    const summary = summarizeJsonSchema(parsed);
    return {
      contentHash: fetched.contentHash,
      name: entry.name,
      properties: summary.properties ?? [],
      required: summary.required ?? [],
      title: summary.title ?? entry.name.replace(/\.schema\.json$/u, ""),
      url: entry.url,
    };
  }));
  const summary: ProviderSchemaSetSummary = {
    entries: schemaEntries,
    repositoryPath: isProviderSchemaSetSummary(snapshot.summary) ? snapshot.summary.repositoryPath : "",
    schemaCount: schemaEntries.length,
  };
  return {
    ...snapshot,
    provenance: {
      contentHash: snapshot.provenance.contentHash,
      fetchedAt: fetchedAt ?? snapshot.provenance.fetchedAt,
      rollingLatest: true,
      sources: [
        {
          ...(listingSource.note === undefined ? {} : { note: listingSource.note }),
          contentHash: listing.contentHash,
          url: listing.url,
        },
      ],
    },
    summary,
  };
}

async function fetchSource(source: ProviderSchemaSource, fetcher: ProviderFetch): Promise<ProviderSchemaSource & { readonly text: string }> {
  const fetched = await fetchText(source.url, fetcher);
  return {
    ...(source.note === undefined ? {} : { note: source.note }),
    contentHash: fetched.contentHash,
    text: fetched.text,
    url: source.url,
  };
}

async function fetchText(url: string, fetcher: ProviderFetch): Promise<{ readonly contentHash: string; readonly text: string }> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return {
    contentHash: sha256(text),
    text,
  };
}

function summarizeJsonSchema(value: unknown): ProviderJsonSchemaSummary {
  const record = readRecord(value, "JSON schema");
  const id = readString(record.$id) ?? readString(record.id);
  const definitions = objectKeys(record.$defs ?? record.definitions);
  const properties = objectKeys(record.properties);
  const required = readStringArray(record.required);
  const title = readString(record.title);
  const topLevelType = readString(record.type);
  const summary: ProviderJsonSchemaSummary = {
    ...(id === undefined ? {} : { id }),
    ...(definitions.length === 0 ? {} : { definitions }),
    ...(properties.length === 0 ? {} : { properties }),
    ...(required.length === 0 ? {} : { required }),
    schemaUri: readString(record.$schema) ?? "",
    ...(title === undefined ? {} : { title }),
    ...(topLevelType === undefined ? {} : { topLevelType }),
  };
  return summary;
}

function readGithubDirectoryEntries(value: unknown): readonly { readonly name: string; readonly url: string }[] {
  if (!Array.isArray(value)) throw new Error("expected GitHub directory listing array");
  return value
    .map((entry) => {
      const record = readRecord(entry, "GitHub directory entry");
      const name = readString(record.name);
      const downloadUrl = readString(record.download_url);
      const type = readString(record.type);
      if (name === undefined || downloadUrl === undefined || type !== "file" || !name.endsWith(".schema.json")) return undefined;
      return { name, url: downloadUrl };
    })
    .filter((entry): entry is { readonly name: string; readonly url: string } => entry !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function summarizeChanges(
  previous: ProviderJsonSchemaSummary | ProviderSchemaSetSummary,
  next: ProviderJsonSchemaSummary | ProviderSchemaSetSummary
): readonly string[] {
  if (stableStringify(previous) === stableStringify(next)) return [];
  if (isProviderSchemaSetSummary(previous) && isProviderSchemaSetSummary(next)) {
    const previousNames = previous.entries.map((entry) => entry.name);
    const nextNames = next.entries.map((entry) => entry.name);
    return [
      ...collectionDiff("entries", previousNames, nextNames),
      ...(previous.schemaCount === next.schemaCount ? [] : [`schemaCount: ${previous.schemaCount} -> ${next.schemaCount}`]),
      ...entryHashChanges(previous.entries, next.entries),
    ];
  }
  if (!isProviderSchemaSetSummary(previous) && !isProviderSchemaSetSummary(next)) {
    return [
      ...collectionDiff("properties", previous.properties ?? [], next.properties ?? []),
      ...collectionDiff("required", previous.required ?? [], next.required ?? []),
      ...collectionDiff("definitions", previous.definitions ?? [], next.definitions ?? []),
      ...(previous.title === next.title ? [] : [`title: ${previous.title ?? "(none)"} -> ${next.title ?? "(none)"}`]),
      ...(previous.topLevelType === next.topLevelType ? [] : [`topLevelType: ${previous.topLevelType ?? "(none)"} -> ${next.topLevelType ?? "(none)"}`]),
    ].filter((line) => line.length > 0);
  }
  return ["summary kind changed"];
}

function entryHashChanges(
  previous: readonly ProviderSchemaSetEntry[],
  next: readonly ProviderSchemaSetEntry[]
): readonly string[] {
  const nextByName = new Map(next.map((entry) => [entry.name, entry]));
  const changes: string[] = [];
  for (const entry of previous) {
    const candidate = nextByName.get(entry.name);
    if (candidate !== undefined && candidate.contentHash !== entry.contentHash) {
      changes.push(`entry ${entry.name}: ${entry.contentHash} -> ${candidate.contentHash}`);
    }
  }
  return changes;
}

function collectionDiff(label: string, previous: readonly string[], next: readonly string[]): readonly string[] {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const added = next.filter((item) => !previousSet.has(item));
  const removed = previous.filter((item) => !nextSet.has(item));
  return [
    ...(added.length === 0 ? [] : [`${label} added: ${added.join(", ")}`]),
    ...(removed.length === 0 ? [] : [`${label} removed: ${removed.join(", ")}`]),
  ];
}

export function renderProviderSchemaSnapshotsSource(
  snapshots: readonly ProviderSchemaSnapshot[],
  manualOverlays: readonly ProviderSchemaManualOverlay[]
): string {
  const orderedSnapshots = [...snapshots].sort((left, right) => left.id.localeCompare(right.id));
  const orderedOverlays = [...manualOverlays].sort((left, right) => left.id.localeCompare(right.id));
  return `import { createHash } from "node:crypto";

export const PROVIDER_SCHEMA_SNAPSHOT_SCHEMA = "skillset-provider-schema@1";

export const PROVIDER_SCHEMA_TARGETS = ["claude", "codex", "cursor"] as const;

export type ProviderSchemaTarget = (typeof PROVIDER_SCHEMA_TARGETS)[number];

export type ProviderSchemaSnapshotId =
${renderStringUnion(orderedSnapshots.map((snapshot) => snapshot.id))};

export type ProviderSchemaManualOverlayId =
${renderStringUnion(orderedOverlays.map((overlay) => overlay.id))};

export type ProviderSchemaJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly ProviderSchemaJsonValue[]
  | { readonly [key: string]: ProviderSchemaJsonValue };

export interface ProviderSchemaSource {
  readonly contentHash: string;
  readonly note?: string;
  readonly url: string;
}

export interface ProviderSchemaProvenance {
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly rollingLatest: true;
  readonly sources: readonly ProviderSchemaSource[];
}

export interface ProviderJsonSchemaSummary {
  readonly definitions?: readonly string[];
  readonly id?: string;
  readonly properties?: readonly string[];
  readonly required?: readonly string[];
  readonly schemaUri: string;
  readonly title?: string;
  readonly topLevelType?: string;
}

export interface ProviderSchemaSetEntry {
  readonly contentHash: string;
  readonly name: string;
  readonly properties: readonly string[];
  readonly required: readonly string[];
  readonly title: string;
  readonly url: string;
}

export interface ProviderSchemaSetSummary {
  readonly entries: readonly ProviderSchemaSetEntry[];
  readonly repositoryPath: string;
  readonly schemaCount: number;
}

export interface ProviderSchemaManualOverlay {
  readonly formatSnapshotId:
    | "claude-skill"
    | "claude-subagent"
    | "codex-agents-md"
    | "codex-plugin"
    | "codex-subagent";
  readonly id: ProviderSchemaManualOverlayId;
  readonly note: string;
  readonly sources: readonly { readonly url: string }[];
  readonly target: ProviderSchemaTarget;
}

export interface ProviderSchemaSnapshot {
  readonly destination: string;
  readonly id: ProviderSchemaSnapshotId;
  readonly provenance: ProviderSchemaProvenance;
  readonly schema: typeof PROVIDER_SCHEMA_SNAPSHOT_SCHEMA;
  readonly summary: ProviderJsonSchemaSummary | ProviderSchemaSetSummary;
  readonly target: ProviderSchemaTarget;
  readonly title: string;
}

const schemaSnapshots = [
${orderedSnapshots.map((snapshot) => `  schemaSnapshot(${renderJson(snapshotInput(snapshot)).replaceAll("\n", "\n  ")}),`).join("\n")}
] as const satisfies readonly ProviderSchemaSnapshot[];

export const providerSchemaSnapshots = defineProviderSchemaSnapshots(schemaSnapshots);

export const providerSchemaManualOverlays = [
${orderedOverlays.map((overlay) => `  manualOverlay(${renderJson(overlay).replaceAll("\n", "\n  ")}),`).join("\n")}
] as const satisfies readonly ProviderSchemaManualOverlay[];

export function listProviderSchemaSnapshots(): readonly ProviderSchemaSnapshot[] {
  return providerSchemaSnapshots;
}

export function getProviderSchemaSnapshot(id: ProviderSchemaSnapshotId): ProviderSchemaSnapshot | undefined {
  return providerSchemaSnapshots.find((snapshot) => snapshot.id === id);
}

export function defineProviderSchemaSnapshots(
  entries: readonly ProviderSchemaSnapshot[]
): readonly ProviderSchemaSnapshot[] {
  assertProviderSchemaSnapshots(entries);
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

export function assertProviderSchemaSnapshots(entries: readonly ProviderSchemaSnapshot[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(\`skillset: duplicate provider schema snapshot \${entry.id}\`);
    ids.add(entry.id);
    if (entry.schema !== PROVIDER_SCHEMA_SNAPSHOT_SCHEMA) {
      throw new Error(\`skillset: unsupported provider schema snapshot schema \${entry.schema}\`);
    }
    if (!PROVIDER_SCHEMA_TARGETS.includes(entry.target)) {
      throw new Error(\`skillset: unsupported provider schema target \${entry.target}\`);
    }
    if (entry.provenance.sources.length === 0) {
      throw new Error(\`skillset: provider schema snapshot \${entry.id} requires at least one source\`);
    }
    for (const source of entry.provenance.sources) {
      if (!/^sha256:[0-9a-f]{64}$/u.test(source.contentHash)) {
        throw new Error(\`skillset: provider schema snapshot \${entry.id} source hash is invalid\`);
      }
      if (!/^https:\\/\\//u.test(source.url)) {
        throw new Error(\`skillset: provider schema snapshot \${entry.id} source must be an https URL\`);
      }
    }
    const actualHash = hashProviderSchemaSnapshot(entry);
    if (entry.provenance.contentHash !== actualHash) {
      throw new Error(\`skillset: provider schema snapshot \${entry.id} hash drifted; expected \${entry.provenance.contentHash}, got \${actualHash}\`);
    }
  }
}

export function hashProviderSchemaSnapshot(snapshot: ProviderSchemaSnapshot): string {
  return \`sha256:\${createHash("sha256").update(normalizeProviderSchemaSnapshot(snapshot)).digest("hex")}\`;
}

export function normalizeProviderSchemaSnapshot(snapshot: ProviderSchemaSnapshot): string {
  const { contentHash: _contentHash, ...provenance } = snapshot.provenance;
  return \`\${stableStringify({
    destination: snapshot.destination,
    id: snapshot.id,
    provenance,
    schema: snapshot.schema,
    summary: snapshot.summary,
    target: snapshot.target,
    title: snapshot.title,
  })}\\n\`;
}

function schemaSnapshot(input: Omit<ProviderSchemaSnapshot, "schema">): ProviderSchemaSnapshot {
  return {
    schema: PROVIDER_SCHEMA_SNAPSHOT_SCHEMA,
    ...input,
  };
}

function manualOverlay(input: ProviderSchemaManualOverlay): ProviderSchemaManualOverlay {
  return input;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortJson(record[key] ?? null);
  }
  return sorted;
}
`;
}

function renderStringUnion(values: readonly string[]): string {
  return values.map((value) => `  | ${JSON.stringify(value)}`).join("\n");
}

function snapshotInput(snapshot: ProviderSchemaSnapshot): Omit<ProviderSchemaSnapshot, "schema"> {
  const { schema: _schema, ...input } = snapshot;
  return input;
}

function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isProviderSchemaSetSummary(
  summary: ProviderJsonSchemaSummary | ProviderSchemaSetSummary
): summary is ProviderSchemaSetSummary {
  return "entries" in summary;
}

function parseJson(text: string, url: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`failed to parse ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`expected ${label} object`);
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectKeys(value: unknown): readonly string[] {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortJson(record[key] ?? null);
  }
  return sorted;
}
