import { createHash } from "node:crypto";
import type { MigrationFlag } from "@skillset/schema";
import { classifyNativeHookLiftDiagnostics, type NativeHookLiftDiagnostic } from "./adaptive-hook-native-lift";
import { createInitialMigrationFlag } from "./migration-state-reconcile";
import { compareStrings } from "./path";
import type { JsonValue, SourceOrigin, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export interface NativeHookFindingSource {
  readonly path: string;
  readonly targets: readonly TargetName[];
  readonly origin?: SourceOrigin;
}

/** Native JSON never receives inline locators or inferred command transformations. */
export function nativeHookFindings(source: NativeHookFindingSource, content: string): readonly MigrationFlag[] {
  const targets = [...new Set(source.targets)].sort(compareStrings);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch {
    return targets.map((target) => unclassifiedFinding(source, content, target, "Native hook JSON could not be parsed; preserve it and review its native contract."));
  }
  const diagnostics = classifyNativeHookLiftDiagnostics({ parsed, sourcePath: source.path, targets, scope: { kind: "plugin" } });
  if (diagnostics.length === 0) {
    const events = isJsonRecord(parsed) && isJsonRecord(parsed.hooks) ? parsed.hooks : parsed;
    if (isJsonRecord(events) && Object.keys(events).length === 0) return [];
    return targets.map((target) => unclassifiedFinding(source, content, target, "Native hook structure was not classified; no portable runtime meaning is established."));
  }
  return diagnostics.map((diagnostic) => flagForDiagnostic(source, content, diagnostic));
}

function flagForDiagnostic(source: NativeHookFindingSource, content: string, diagnostic: NativeHookLiftDiagnostic): MigrationFlag {
  return createInitialMigrationFlag({
    code: `adopt.${diagnostic.code}`,
    severity: "warning",
    disposition: diagnostic.status === "unsupported" ? "lossy-unsupported" : diagnostic.status === "native-only" ? "provider-native" : "ambiguous",
    message: `[${diagnostic.target}] ${diagnostic.message}`,
    source: { path: source.path },
    ...(source.origin === undefined ? {} : { origin: { path: source.origin.path } }),
    fingerprints: { content: digest(content), context: digest(`${diagnostic.target}:${diagnostic.path}`) },
    placement: { kind: "sidecar", reason: "Provider-native JSON must remain byte-preserved." },
    evidence: [
      ...(source.origin?.repo === undefined ? [] : [{ summary: "Original repository.", reference: source.origin.repo }]),
      ...(source.origin?.ref === undefined ? [] : [{ summary: `Original revision: ${source.origin.ref}.` }]),
      { summary: `Assessment target: ${diagnostic.target}; hook location: ${diagnostic.path}. Event/handler evidence does not verify arbitrary command semantics.`, ...(diagnostic.providerRef === undefined ? {} : { reference: diagnostic.providerRef }) },
    ],
    relatedReportIds: [],
  });
}

function unclassifiedFinding(source: NativeHookFindingSource, content: string, target: TargetName, message: string): MigrationFlag {
  return flagForDiagnostic(source, content, { code: "native-hook-runtime-unverified", status: "unknown", target, message, event: "unclassified", groupIndex: 0, path: source.path });
}

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
