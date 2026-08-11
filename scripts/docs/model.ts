import { isAbsolute, posix, relative, resolve } from "node:path";

export const DOCS_BASELINE_SCHEMA_VERSION = 1;

export type DocsRule =
  | "docs/description-required"
  | "docs/description-shape"
  | "docs/generated-marker"
  | "docs/h1-count"
  | "docs/link-anchor"
  | "docs/link-form"
  | "docs/link-target"
  | "docs/migration-map"
  | "docs/provider-id"
  | "docs/reachability"
  | "docs/syntax";

export interface DocsDiagnostic {
  readonly line?: number;
  readonly message: string;
  readonly path: string;
  readonly rule: DocsRule;
  readonly subject: string;
}

export interface DocsBaseline {
  readonly diagnostics: readonly string[];
  readonly schemaVersion: typeof DOCS_BASELINE_SCHEMA_VERSION;
}

export function diagnosticIdentity(diagnostic: DocsDiagnostic): string {
  return `${diagnostic.rule}|${normalizeRepoPath(diagnostic.path)}|${normalizeSubject(diagnostic.subject)}`;
}

export function compareDocsDiagnostics(
  left: DocsDiagnostic,
  right: DocsDiagnostic
): number {
  return diagnosticIdentity(left).localeCompare(diagnosticIdentity(right));
}

export function normalizeRepoPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function normalizeSubject(subject: string): string {
  return subject.trim().replaceAll(/\s+/gu, " ");
}

export function isSafeRepoPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  return (
    normalized.length > 0 &&
    !/[\u0000-\u001f\u007f]/u.test(normalized) &&
    !/^[a-z]:\//iu.test(normalized) &&
    !isAbsolute(normalized) &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../") &&
    normalized === posix.normalize(normalized)
  );
}

export function repoRelativePath(
  root: string,
  path: string
): string | undefined {
  const value = normalizeRepoPath(relative(resolve(root), resolve(path)));
  return isSafeRepoPath(value) ? value : undefined;
}

export function requiresDescription(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  if (!normalized.startsWith("docs/")) return false;
  return !(
    normalized === "docs/project/plans/archive/0x-latest.md" ||
    normalized.startsWith("docs/adrs/") ||
    normalized.startsWith("docs/development/evidence/") ||
    normalized.startsWith("docs/project/plans/") ||
    normalized.startsWith("docs/reference/schemas/")
  );
}

export function isPublicPage(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  if (normalized === "README.md") return true;
  if (!normalized.startsWith("docs/")) return false;
  return !(
    normalized === "docs/project/plans/archive/0x-latest.md" ||
    normalized.startsWith("docs/adrs/") ||
    normalized.startsWith("docs/development/") ||
    normalized.startsWith("docs/development/evidence/") ||
    normalized.startsWith("docs/project/") ||
    normalized.startsWith("docs/reference/schemas/")
  );
}

export function requiresReachability(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  return (
    isPublicPage(normalized) ||
    normalized.startsWith("docs/development/") ||
    normalized.startsWith("docs/project/")
  );
}

export function formatDocsDiagnostic(diagnostic: DocsDiagnostic): string {
  const location =
    diagnostic.line === undefined
      ? diagnostic.path
      : `${diagnostic.path}:${diagnostic.line}`;
  return `${location} [${diagnostic.rule}] ${diagnostic.message}`;
}
