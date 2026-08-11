import path from "node:path";

import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import { isSafeRepoPath, normalizeRepoPath } from "./model";
import type { DocsDiagnostic } from "./model";

export const MIGRATION_MAP_SCHEMA_VERSION = 1;

export type MigrationStatus = "archived" | "deleted" | "moved" | "split";

export interface MigrationEntry {
  readonly from: string;
  readonly primary?: string;
  readonly status: MigrationStatus;
  readonly successors?: readonly string[];
}

export interface MigrationMap {
  readonly entries: readonly MigrationEntry[];
  readonly schemaVersion: typeof MIGRATION_MAP_SCHEMA_VERSION;
}

export type GitMarkdownChange =
  | { readonly path: string; readonly status: string }
  | {
      readonly from: string;
      readonly status: string;
      readonly to: string;
    };

export interface MigrationValidationResult {
  readonly diagnostics: readonly DocsDiagnostic[];
  readonly map?: MigrationMap;
}

export type MigrationCommandRunner = (
  command: readonly string[],
  options: { readonly cwd: string }
) => Promise<string>;

export type MigrationPathPredicate = (path: string) => boolean;

const MAP_PATH = "docs/migration-map.json";
const ENTRY_KEYS = new Set(["from", "primary", "status", "successors"]);
const MAP_KEYS = new Set(["entries", "schemaVersion"]);
const STATUSES = new Set<MigrationStatus>([
  "archived",
  "deleted",
  "moved",
  "split",
]);

export function parseMigrationMap(
  text: string,
  options: {
    readonly mapPath?: string;
    readonly pathExists: (path: string) => boolean;
  }
): MigrationValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          options.mapPath,
          "json",
          `migration map must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
        ),
      ],
    };
  }
  return validateMigrationMap(value, options);
}

export function validateMigrationMap(
  value: unknown,
  options: {
    readonly mapPath?: string;
    readonly pathExists: (path: string) => boolean;
  }
): MigrationValidationResult {
  const diagnostics: DocsDiagnostic[] = [];
  const mapPath = options.mapPath ?? MAP_PATH;
  if (!isRecord(value)) {
    return {
      diagnostics: [
        diagnostic(mapPath, "document", "migration map must be a JSON object"),
      ],
    };
  }

  reportUnknownKeys(value, MAP_KEYS, mapPath, "document", diagnostics);
  if (value.schemaVersion !== MIGRATION_MAP_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        mapPath,
        "schemaVersion",
        `schemaVersion must be ${MIGRATION_MAP_SCHEMA_VERSION}`
      )
    );
  }
  if (!Array.isArray(value.entries)) {
    diagnostics.push(
      diagnostic(mapPath, "entries", "entries must be an array")
    );
    return { diagnostics };
  }

  const entries: MigrationEntry[] = [];
  const seenSources = new Set<string>();
  for (const [index, candidate] of value.entries.entries()) {
    const subject = `entries[${index}]`;
    if (!isRecord(candidate)) {
      diagnostics.push(
        diagnostic(mapPath, subject, "migration entry must be an object")
      );
      continue;
    }
    reportUnknownKeys(candidate, ENTRY_KEYS, mapPath, subject, diagnostics);

    const from = readMarkdownPath(
      candidate.from,
      mapPath,
      `${subject}.from`,
      diagnostics
    );
    const status = readStatus(
      candidate.status,
      mapPath,
      `${subject}.status`,
      diagnostics
    );
    const primary = readOptionalMarkdownPath(
      candidate.primary,
      mapPath,
      `${subject}.primary`,
      diagnostics
    );
    const successors = readSuccessors(
      candidate.successors,
      mapPath,
      `${subject}.successors`,
      diagnostics
    );

    if (from !== undefined) {
      if (seenSources.has(from)) {
        diagnostics.push(
          diagnostic(
            mapPath,
            `source:${from}`,
            `migration source is duplicated: ${from}`
          )
        );
      } else {
        seenSources.add(from);
      }
      if (options.pathExists(from)) {
        diagnostics.push(
          diagnostic(
            mapPath,
            `${subject}.from`,
            `migration source must no longer exist: ${from}`
          )
        );
      }
    }

    if (status === "deleted") {
      if (Object.hasOwn(candidate, "primary")) {
        diagnostics.push(
          diagnostic(
            mapPath,
            `${subject}.primary`,
            "deleted entries must omit primary"
          )
        );
      }
      if (Object.hasOwn(candidate, "successors")) {
        diagnostics.push(
          diagnostic(
            mapPath,
            `${subject}.successors`,
            "deleted entries must omit successors"
          )
        );
      }
    } else if (status !== undefined) {
      if (primary === undefined) {
        diagnostics.push(
          diagnostic(
            mapPath,
            `${subject}.primary`,
            `${status} entries require primary`
          )
        );
      } else if (!options.pathExists(primary)) {
        diagnostics.push(
          diagnostic(
            mapPath,
            `${subject}.primary`,
            `migration primary does not exist: ${primary}`
          )
        );
      }
      if (
        primary !== undefined &&
        successors !== undefined &&
        !successors.includes(primary)
      ) {
        diagnostics.push(
          diagnostic(
            mapPath,
            `${subject}.successors`,
            `successors must include primary: ${primary}`
          )
        );
      }
    }

    if (status !== "deleted" && successors !== undefined) {
      for (const successor of successors) {
        if (!options.pathExists(successor)) {
          diagnostics.push(
            diagnostic(
              mapPath,
              `${subject}.successors:${successor}`,
              `migration successor does not exist: ${successor}`
            )
          );
        }
      }
    }

    if (from !== undefined && status !== undefined) {
      entries.push({
        from,
        ...(primary === undefined ? {} : { primary }),
        status,
        ...(successors === undefined ? {} : { successors }),
      });
    }
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }
  return {
    diagnostics,
    map: {
      entries,
      schemaVersion: MIGRATION_MAP_SCHEMA_VERSION,
    },
  };
}

export function parseGitNameStatus(
  output: string
): readonly GitMarkdownChange[] {
  if (output.length === 0) {
    return [];
  }
  const fields = output.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  const changes: GitMarkdownChange[] = [];

  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!status) {
      throw new Error("Git name-status output contains an empty status");
    }
    if (/^[RC]\d{1,3}$/u.test(status)) {
      const score = Number.parseInt(status.slice(1), 10);
      const from = fields[index++];
      const to = fields[index++];
      if (score > 100 || !from || !to) {
        throw new Error(`Git name-status output is malformed for ${status}`);
      }
      changes.push({
        from: normalizeRepoPath(from),
        status,
        to: normalizeRepoPath(to),
      });
      continue;
    }
    const path = fields[index++];
    if (!path) {
      throw new Error(`Git name-status output is malformed for ${status}`);
    }
    changes.push({ path: normalizeRepoPath(path), status });
  }

  return changes;
}

export function validateMigrationAccounting(
  entries: readonly MigrationEntry[],
  changes: readonly GitMarkdownChange[],
  mapPath = MAP_PATH,
  isDocumentationPath: MigrationPathPredicate = isMigrationDocumentationPath
): readonly DocsDiagnostic[] {
  const entriesBySource = new Map(entries.map((entry) => [entry.from, entry]));
  const requiredSources = new Set<string>();
  for (const change of changes) {
    if (change.status === "D" && "path" in change) {
      if (isDocumentationPath(change.path)) {
        requiredSources.add(change.path);
      }
      continue;
    }
    if (
      change.status.startsWith("R") &&
      "from" in change &&
      isDocumentationPath(change.from)
    ) {
      requiredSources.add(change.from);
    }
  }
  const diagnostics = [...requiredSources]
    .filter((path) => !entriesBySource.has(path))
    .toSorted()
    .map((path) =>
      diagnostic(
        mapPath,
        `unmapped:${path}`,
        `removed Markdown path requires a migration entry: ${path}`
      )
    );
  for (const change of changes) {
    if (
      !change.status.startsWith("R") ||
      !("from" in change) ||
      !isDocumentationPath(change.from)
    ) {
      continue;
    }
    const entry = entriesBySource.get(change.from);
    if (entry === undefined) continue;
    const destinations = new Set([
      ...(entry.primary === undefined ? [] : [entry.primary]),
      ...(entry.successors ?? []),
    ]);
    if (entry.status === "deleted" || !destinations.has(change.to)) {
      diagnostics.push(
        diagnostic(
          mapPath,
          `rename:${change.from}`,
          `migration entry must account for Git rename destination: ${change.to}`
        )
      );
    }
  }
  return diagnostics.toSorted((left, right) =>
    left.subject.localeCompare(right.subject)
  );
}

export async function discoverMarkdownChanges(
  repoRoot: string,
  run: MigrationCommandRunner = runMigrationCommand,
  isDocumentationPath: MigrationPathPredicate = isMigrationDocumentationPath
): Promise<readonly GitMarkdownChange[]> {
  const trunk = (
    await run([path.join(repoRoot, "scripts", "git-trunk.sh")], {
      cwd: repoRoot,
    })
  ).trim();
  if (trunk.length === 0) {
    throw new Error("Git trunk resolver returned no ref");
  }
  const mergeBase = (
    await run(["git", "merge-base", trunk, "HEAD"], { cwd: repoRoot })
  ).trim();
  if (mergeBase.length === 0) {
    throw new Error("Git merge-base returned no revision");
  }
  const output = await run(
    ["git", "diff", "--name-status", "-z", "-M", mergeBase, "--", "*.md"],
    { cwd: repoRoot }
  );
  return parseGitNameStatus(output).filter((change) =>
    "path" in change
      ? isDocumentationPath(change.path)
      : isDocumentationPath(change.from) || isDocumentationPath(change.to)
  );
}

export function isMigrationDocumentationPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  return (
    normalized.startsWith("docs/") ||
    normalized === "README.md" ||
    normalized === "CONTRIBUTING.md" ||
    normalized === "SECURITY.md" ||
    (normalized.startsWith("examples/") && normalized.endsWith("/README.md"))
  );
}

async function runMigrationCommand(
  command: readonly string[],
  options: { readonly cwd: string }
): Promise<string> {
  const process = Bun.spawn({
    cmd: [...command],
    cwd: options.cwd,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `${command[0]} failed`);
  }
  return stdout;
}

function readStatus(
  value: unknown,
  mapPath: string,
  subject: string,
  diagnostics: DocsDiagnostic[]
): MigrationStatus | undefined {
  if (typeof value === "string" && STATUSES.has(value as MigrationStatus)) {
    return value as MigrationStatus;
  }
  diagnostics.push(
    diagnostic(
      mapPath,
      subject,
      "status must be moved, split, archived, or deleted"
    )
  );
  return undefined;
}

function readOptionalMarkdownPath(
  value: unknown,
  mapPath: string,
  subject: string,
  diagnostics: DocsDiagnostic[]
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readMarkdownPath(value, mapPath, subject, diagnostics);
}

function readMarkdownPath(
  value: unknown,
  mapPath: string,
  subject: string,
  diagnostics: DocsDiagnostic[]
): string | undefined {
  if (
    typeof value !== "string" ||
    value !== normalizeRepoPath(value) ||
    !isSafeRepoPath(value) ||
    !value.endsWith(".md") ||
    !isMigrationDocumentationPath(value)
  ) {
    diagnostics.push(
      diagnostic(
        mapPath,
        subject,
        "path must be a normalized repository-relative documentation Markdown path"
      )
    );
    return undefined;
  }
  return value;
}

function readSuccessors(
  value: unknown,
  mapPath: string,
  subject: string,
  diagnostics: DocsDiagnostic[]
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic(mapPath, subject, "successors must be an array")
    );
    return undefined;
  }
  const successors: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = readMarkdownPath(
      candidate,
      mapPath,
      `${subject}[${index}]`,
      diagnostics
    );
    if (path === undefined) {
      continue;
    }
    if (seen.has(path)) {
      diagnostics.push(
        diagnostic(
          mapPath,
          `${subject}:${path}`,
          `migration successor is duplicated: ${path}`
        )
      );
      continue;
    }
    seen.add(path);
    successors.push(path);
  }
  return successors;
}

function reportUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  mapPath: string,
  subject: string,
  diagnostics: DocsDiagnostic[]
): void {
  for (const key of Object.keys(value).toSorted()) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic(
          mapPath,
          `${subject}.${key}`,
          `unknown migration-map field: ${key}`
        )
      );
    }
  }
}

function diagnostic(
  mapPath = MAP_PATH,
  subject: string,
  message: string
): DocsDiagnostic {
  return {
    message,
    path: mapPath,
    rule: "docs/migration-map",
    subject,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
