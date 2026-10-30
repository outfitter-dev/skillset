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
  /** Inline event maps within the physical JSON file; omitted for a hook file. */
  readonly pointers?: readonly string[];
}

export type NativeHookSourceDiagnostic = Omit<NativeHookLiftDiagnostic, "code"> & {
  readonly code: NativeHookLiftDiagnostic["code"] | "native-hook-lift-unclassified";
};

/** Native JSON never receives inline locators or inferred command transformations. */
export function nativeHookFindings(source: NativeHookFindingSource, content: string): readonly MigrationFlag[] {
  return classifyNativeHookSource(source, content).map((diagnostic) => flagForDiagnostic(source, content, diagnostic));
}

/** Shared by import reporting and the durable ledger so both assess the same locations. */
export function classifyNativeHookSource(source: NativeHookFindingSource, content: string): readonly NativeHookSourceDiagnostic[] {
  const targets = [...new Set(source.targets)].sort(compareStrings);
  const unclassified = (path: string, message: string): readonly NativeHookSourceDiagnostic[] => targets.map((target) => ({
    code: "native-hook-lift-unclassified", status: "unknown", target, message,
    event: "unclassified", groupIndex: 0, path,
  }));
  let parsed: JsonValue;
  try { parsed = JSON.parse(content) as JsonValue; }
  catch { return unclassified(source.path, "Native hook JSON could not be parsed; preserve it and review its native contract."); }
  const pointers = source.pointers === undefined ? [undefined] : [...new Set(source.pointers)].sort(compareStrings);
  return pointers.flatMap((pointer) => {
    const selected = pointer === undefined ? parsed : selectPointer(parsed, pointer);
    const location = pointer === undefined ? source.path : `${source.path}#${pointer}`;
    if (selected === undefined || (pointer !== undefined && !isJsonRecord(selected))) {
      return unclassified(location, "Native inline hook location is missing or is not an event map; preserve the manifest and review its native contract.");
    }
    const diagnostics = classifyNativeHookLiftDiagnostics({
      parsed: pointer === undefined ? selected : { hooks: selected }, sourcePath: source.path, targets, scope: { kind: "plugin" },
    });
    if (diagnostics.length === 0) {
      const events = pointer !== undefined ? selected : isJsonRecord(selected) && isJsonRecord(selected.hooks) ? selected.hooks : selected;
      if (isJsonRecord(events) && Object.keys(events).length === 0) return [];
      return unclassified(location, "Native hook structure was not classified; no portable runtime meaning is established.");
    }
    return diagnostics.map((diagnostic) => pointer === undefined ? diagnostic : {
      ...diagnostic, path: `${source.path}#${pointer}${diagnostic.path.slice(`${source.path}#/hooks`.length)}`,
    });
  });
}

function selectPointer(value: JsonValue, pointer: string): JsonValue | undefined {
  if (!pointer.startsWith("/") || /~(?![01])/.test(pointer)) return undefined;
  let selected: JsonValue | undefined = value;
  for (const part of pointer.slice(1).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(selected)) selected = /^(0|[1-9][0-9]*)$/.test(key) ? selected[Number(key)] : undefined;
    else if (isJsonRecord(selected) && Object.hasOwn(selected, key)) selected = selected[key];
    else return undefined;
  }
  return selected;
}

function flagForDiagnostic(source: NativeHookFindingSource, content: string, diagnostic: NativeHookSourceDiagnostic): MigrationFlag {
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

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
