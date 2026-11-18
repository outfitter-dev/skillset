import { createHash } from "node:crypto";
import type { MigrationFlag } from "@skillset/schema";
import { recognizeTransforms, transformEntries } from "@skillset/transforms";
import { readRecord, readString } from "./config";
import { planMigrationMarker } from "./migration-markers";
import { createInitialMigrationFlag } from "./migration-state-reconcile";
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

export function annotateImportedBody(path: string, before: string): AnnotatedDocument {
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
