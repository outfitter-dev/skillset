import { mcpDependencyFindings, type McpDependencyFindingSource } from "./adoption-mcp-dependencies";
import { readFile } from "node:fs/promises";
import type { MigrationFlag, MigrationState } from "@skillset/schema";
import { importedFrontmatterFindings, type FrontmatterFindingSource } from "./adoption-frontmatter-findings";
import { annotateImportedBody } from "./adoption-body-findings";
import { nativeHookFindings, type NativeHookFindingSource } from "./adoption-native-findings";
import { inspectMigrationMarkers } from "./migration-markers";
import { assertMigrationState, planMigrationStateWrite, readMigrationState } from "./migration-state";
import { compareStrings } from "./path";
import { prepareRepositoryMutationPath } from "./repository-mutation";
import { applyWorkspaceTransaction, type WorkspaceTransactionOptions } from "./workspace-transaction";

export interface ImportedFindingSources {
  readonly frontmatter?: readonly FrontmatterFindingSource[];
  readonly bodyPaths?: readonly string[];
  readonly mcpDependencies?: readonly McpDependencyFindingSource[];
  readonly nativeHooks?: readonly NativeHookFindingSource[];
}

/** Add new-source findings together; existing decisions require a complete lifecycle scan. */
export async function recordImportedFindings(
  rootPath: string,
  sources: ImportedFindingSources,
  transactionOptions: WorkspaceTransactionOptions = {}
): Promise<{ readonly flags: readonly MigrationFlag[]; readonly writtenPaths: readonly string[] }> {
  const frontmatter = new Map<string, FrontmatterFindingSource[]>();
  for (const source of sources.frontmatter ?? []) {
    frontmatter.set(source.path, [...(frontmatter.get(source.path) ?? []), source]);
  }
  const inputs = [
    ...[...new Set([...(sources.bodyPaths ?? []), ...frontmatter.keys()])].map((path) => ({ kind: "body" as const, path })),
    ...(sources.mcpDependencies ?? []).map((source) => ({ ...source, kind: "mcp-dependencies" as const })),
    ...(sources.nativeHooks ?? []).map((source) => ({ ...source, kind: "native-hooks" as const })),
  ].sort((left, right) => compareStrings(left.path, right.path));
  if (inputs.length === 0) return { flags: [], writtenPaths: [] };
  if (new Set(inputs.map((input) => input.path)).size !== inputs.length) {
    throw new Error("skillset: imported finding sources must have one owner per path.");
  }
  const previous = await readMigrationState(rootPath);
  const documents: (ReturnType<typeof annotateImportedBody> & { readonly kind: "body" | "native-hooks" | "mcp-dependencies" })[] = [];
  for (const input of inputs) {
    const { path } = input;
    if (previous.state.flags.some((flag) => flag.source.path === path)) {
      throw new Error(`skillset: ${path} already has migration records; review them before adding findings for this source.`);
    }
    const prepared = await prepareRepositoryMutationPath(rootPath, path, { createParents: false });
    const content = await readFile(prepared.path, "utf8");
    if (input.kind === "mcp-dependencies") {
      documents.push({ kind: input.kind, path, before: content, content, flags: mcpDependencyFindings(input, content) });
      continue;
    }
    if (input.kind === "native-hooks") {
      documents.push({ kind: input.kind, path, before: content, content, flags: nativeHookFindings(input, content) });
      continue;
    }
    const inspected = inspectMigrationMarkers({ content, path, state: previous.state });
    if (inspected.diagnostics.length > 0) {
      throw new Error(`skillset: ${path}: ${inspected.diagnostics.map((item) => item.message).join("; ")}`);
    }
    const document = annotateImportedBody(path, content);
    const fields = frontmatter.get(path);
    documents.push({ ...document, flags: [...document.flags, ...(fields === undefined ? [] : fields.flatMap((source) => importedFrontmatterFindings(source, document.content)))], kind: input.kind });
  }
  const flags = documents.flatMap((document) => document.flags);
  if (flags.length === 0) return { flags: [], writtenPaths: [] };
  const next: MigrationState = { ...previous.state, flags: [...previous.state.flags, ...flags] };
  assertMigrationState(next);
  for (const document of documents.filter((document) => document.kind === "body")) {
    const inspected = inspectMigrationMarkers({ content: document.content, path: document.path, state: next });
    if (inspected.diagnostics.length > 0 || inspected.content !== document.before) {
      throw new Error(`skillset: ${document.path}: migration locators do not preserve the imported source.`);
    }
  }
  const writes = [
    ...documents.filter((document) => document.content !== document.before).map((document) => ({
      path: document.path, content: document.content, expectedContent: document.before,
    })),
    planMigrationStateWrite(previous, next),
  ];
  await applyWorkspaceTransaction(rootPath, {
    writes,
    readOnlyInputs: documents.filter((document) => document.content === document.before).map((document) => ({
      path: document.path, content: document.before,
    })),
  }, transactionOptions);
  return { flags, writtenPaths: writes.map((write) => write.path) };
}
