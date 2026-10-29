import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MigrationFlag, MigrationState } from "@skillset/schema";
import { recognizeTransforms, transformEntries } from "@skillset/transforms";
import { readRecord, readString } from "./config";
import { inspectMigrationMarkers, planMigrationMarker } from "./migration-markers";
import { createInitialMigrationFlag } from "./migration-state-reconcile";
import { assertMigrationState, planMigrationStateWrite, readMigrationState } from "./migration-state";
import { compareStrings } from "./path";
import { prepareRepositoryMutationPath } from "./repository-mutation";
import { applyWorkspaceTransaction, type WorkspaceTransactionOptions } from "./workspace-transaction";
import { parseMarkdown } from "./yaml";

/** Recognition is lexical evidence only; it does not establish source dialect or portable intent. */
export function recognizeAdoptionBody(body: string) {
  const masked = body.replace(
    /\{\{\s*\$ARGUMENTS(?:\[[0-9]+\]|\.[A-Za-z_][A-Za-z0-9_-]*)?\s*\}\}/gu,
    (token) => token.replace(/[^\r\n]/gu, " ")
  );
  return recognizeTransforms(masked, "claude");
}

interface AnnotatedDocument {
  readonly path: string;
  readonly before: string;
  readonly content: string;
  readonly flags: readonly MigrationFlag[];
}

/**
 * Add findings only for newly imported sources. This is not a workspace rescan:
 * existing records are retained exactly, and paths already owned by the ledger
 * require the review lifecycle instead of guessed identity reconciliation.
 */
export async function recordImportedBodyFindings(
  rootPath: string,
  sourcePaths: readonly string[],
  transactionOptions: WorkspaceTransactionOptions = {}
): Promise<{ readonly flags: readonly MigrationFlag[]; readonly writtenPaths: readonly string[] }> {
  if (sourcePaths.length === 0) return { flags: [], writtenPaths: [] };
  const previous = await readMigrationState(rootPath);
  const documents: AnnotatedDocument[] = [];
  for (const path of [...new Set(sourcePaths)].sort(compareStrings)) {
    if (previous.state.flags.some((flag) => flag.source.path === path)) {
      throw new Error(`skillset: ${path} already has migration records; review them before adding findings for this source.`);
    }
    const prepared = await prepareRepositoryMutationPath(rootPath, path, { createParents: false });
    const content = await readFile(prepared.path, "utf8");
    const inspected = inspectMigrationMarkers({ content, path, state: previous.state });
    if (inspected.diagnostics.length > 0) {
      throw new Error(`skillset: ${path}: ${inspected.diagnostics.map((item) => item.message).join("; ")}`);
    }
    documents.push(annotateBody(path, content));
  }
  const flags = documents.flatMap((document) => document.flags);
  if (flags.length === 0) return { flags: [], writtenPaths: [] };
  const next: MigrationState = { ...previous.state, flags: [...previous.state.flags, ...flags] };
  assertMigrationState(next);
  for (const document of documents) {
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

function annotateBody(path: string, before: string): AnnotatedDocument {
  const { body, frontmatter } = parseMarkdown(before, path);
  const bodyLines = body.split("\n");
  const bodyOffset = before.split(/\r\n|\n|\r/u).length - bodyLines.length;
  const origin = readString(readRecord(readRecord(frontmatter, "skillset") ?? {}, "origin") ?? {}, "path");
  const flags = recognizeAdoptionBody(body).map((match) => {
    const prefix = body.slice(0, match.index);
    const bodyLine = prefix.split("\n").length;
    const entry = transformEntries.get(match.intent);
    return createInitialMigrationFlag({
      code: `adopt.ambiguous-${match.intent.replaceAll(".", "-")}`,
      severity: "warning", disposition: "ambiguous",
      message: "Review this preserved text; author intent and destination support are not established.",
      source: { path, line: bodyOffset + bodyLine, column: match.index - prefix.lastIndexOf("\n") },
      ...(origin === undefined ? {} : { origin: { path: origin } }),
      fingerprints: {
        content: digest(match.text),
        context: digest(bodyLines.slice(Math.max(0, bodyLine - 2), bodyLine + 1).join("\n")),
      },
      placement: { kind: "sidecar", reason: "Pending safe locator planning." },
      evidence: [
        { summary: "A lexical recognizer found this construct; author intent and cross-provider equivalence remain unknown.", reference: `transform:${match.intent}` },
        ...(entry?.evidence ?? []).map((item) => ({
          summary: `Recognizer reference recorded ${item.verified}. ${item.note ?? "This is not proof of the imported author's intent."}`,
          reference: item.source,
        })),
      ],
      relatedReportIds: [],
    });
  });
  const inlineLines = new Set<number>();
  const planned = flags.map((flag): MigrationFlag => {
    const line = flag.source.line!;
    if (inlineLines.has(line)) return { ...flag, placement: { kind: "sidecar", reason: "This source line already has a review locator." } };
    const plan = planMigrationMarker({ content: before, path, flag, beforeLine: line, kind: "adaptive-markdown" });
    if (plan.placement.kind === "inline") inlineLines.add(line);
    return { ...flag, placement: plan.placement };
  });
  let content = before;
  for (const flag of [...planned].reverse()) {
    if (flag.placement.kind !== "inline") continue;
    const plan = planMigrationMarker({ content, path, flag, beforeLine: flag.placement.line, kind: "adaptive-markdown" });
    if (plan.content === undefined) throw new Error(`skillset: ${path}: migration locator placement changed during planning.`);
    content = plan.content;
  }
  return {
    path, before, content,
    flags: planned.map((flag) => ({
      ...flag,
      source: { ...flag.source, line: flag.source.line! + [...inlineLines].filter((line) => line <= flag.source.line!).length },
      placement: flag.placement.kind === "sidecar" ? flag.placement : {
        ...flag.placement,
        line: flag.placement.line + [...inlineLines].filter((line) => line < flag.source.line!).length,
      },
    })),
  };
}

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
