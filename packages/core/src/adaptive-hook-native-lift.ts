import {
  classifyAdaptiveHookIntent,
  type AdaptiveHookRenderSurface,
} from "./adaptive-hook-classifier";
import type { ResolvedAdaptiveHookAttachment } from "./adaptive-hook-attachments";
import type { AdaptiveHookScope, JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export type NativeHookLiftDiagnosticCode =
  | "native-hook-runtime-unverified"
  | "native-hook-native-only"
  | "native-hook-unsupported";

export interface NativeHookLiftDiagnostic {
  readonly code: NativeHookLiftDiagnosticCode;
  readonly event: string;
  readonly groupIndex: number;
  readonly matcherEvaluation?: string;
  readonly matcherKind?: string;
  readonly message: string;
  readonly path: string;
  readonly providerRef?: string;
  readonly status: "native-only" | "unsupported" | "unknown";
  readonly target: TargetName;
}

export interface NativeHookLiftDiagnosticsOptions {
  readonly parsed: JsonValue;
  readonly scope: AdaptiveHookScope;
  readonly sourcePath: string;
  readonly surface?: AdaptiveHookRenderSurface;
  readonly targets: readonly TargetName[];
}

export function classifyNativeHookLiftDiagnostics(
  options: NativeHookLiftDiagnosticsOptions
): readonly NativeHookLiftDiagnostic[] {
  if (!isJsonRecord(options.parsed)) {
    return unsupportedNativeStructure(options, "Native hook source must be a JSON object.");
  }
  if (options.parsed.hooks !== undefined && !isJsonRecord(options.parsed.hooks)) {
    return unsupportedNativeStructure(options, "Native hook hooks field must be an event map.", "unclassified", "/hooks");
  }
  const events = isJsonRecord(options.parsed.hooks) ? options.parsed.hooks : options.parsed;
  const pointerRoot = events === options.parsed ? "" : "/hooks";
  const surface = options.surface ?? "plugin";
  const diagnostics: NativeHookLiftDiagnostic[] = [];

  for (const [event, groups] of Object.entries(events)) {
    if (events === options.parsed && event === "hooks") continue;
    if (!Array.isArray(groups)) {
      diagnostics.push(...unsupportedNativeStructure(options, `Native hook ${event} must map to an array of handler groups.`, event, `${pointerRoot}/${pointerSegment(event)}`));
      continue;
    }
    groups.forEach((group, groupIndex) => {
      const path = `${options.sourcePath}#${pointerRoot}/${pointerSegment(event)}/${groupIndex}`;
      const candidate = nativeHookGroupCandidate({
        event,
        group,
        groupIndex,
        path,
        scope: options.scope,
      });
      for (const target of options.targets) {
        if (candidate.item === undefined) {
          diagnostics.push({
            code: "native-hook-unsupported",
            event,
            groupIndex,
            message: candidate.reason,
            path,
            status: "unsupported",
            target,
          });
          continue;
        }
        const classification = classifyAdaptiveHookIntent(candidate.item, target, surface);
        // Event/handler compatibility cannot establish the semantics of an
        // arbitrary command, its environment, or provider payload consumption.
        const status = classification.status === "lossless-adaptive" || classification.status === "provider-scoped-adaptive"
          ? "unknown"
          : classification.status;
        diagnostics.push({
          code: codeForStatus(status),
          event,
          groupIndex,
          matcherEvaluation: classification.matcherEvaluation,
          matcherKind: classification.matcherKind,
          message: messageForClassification(status, event, groupIndex, target, classification.reason),
          path,
          providerRef: classification.providerRef,
          status,
          target,
        });
      }
    });
  }

  return diagnostics;
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unsupportedNativeStructure(
  options: NativeHookLiftDiagnosticsOptions,
  message: string,
  event = "unclassified",
  pointer = ""
): readonly NativeHookLiftDiagnostic[] {
  return options.targets.map((target) => ({
    code: "native-hook-unsupported", status: "unsupported", target, message,
    event, groupIndex: 0, path: `${options.sourcePath}#${pointer}`,
  }));
}

function nativeHookGroupCandidate(options: {
  readonly event: string;
  readonly group: JsonValue;
  readonly groupIndex: number;
  readonly path: string;
  readonly scope: AdaptiveHookScope;
}): { readonly item?: ResolvedAdaptiveHookAttachment; readonly reason: string } {
  const label = `Native hook ${options.event} group ${options.groupIndex}`;
  if (!isJsonRecord(options.group)) {
    return { reason: `${label} is not a JSON object, so Skillset cannot prove a faithful adaptive lift.` };
  }

  const extraGroupFields = Object.keys(options.group).filter((key) => key !== "hooks" && key !== "matcher" && key !== "statusMessage").sort();
  if (extraGroupFields.length > 0) {
    return { reason: `${label} uses group field ${extraGroupFields.join(", ")}, which adaptive hook lifting does not model yet.` };
  }

  const handlers = options.group.hooks;
  if (!Array.isArray(handlers) || handlers.length !== 1) {
    const count = Array.isArray(handlers) ? handlers.length : 0;
    return { reason: `${label} has ${count} handler(s); adaptive hook lifting requires exactly one command handler.` };
  }

  const handler = handlers[0];
  if (!isJsonRecord(handler)) {
    return { reason: `${label} handler is not a JSON object, so Skillset cannot prove a faithful adaptive lift.` };
  }

  if (handler.type !== "command") {
    const type = typeof handler.type === "string" ? handler.type : "missing/non-string";
    return { reason: `${label} uses ${type} handler type; adaptive hook lifting only models command handlers.` };
  }

  if (typeof handler.command !== "string" || handler.command.trim().length === 0) {
    return { reason: `${label} command handler must have a non-empty command string to lift adaptively.` };
  }

  const extraHandlerFields = Object.keys(handler).filter((key) => key !== "command" && key !== "type").sort();
  if (extraHandlerFields.length > 0) {
    return { reason: `${label} command handler uses field ${extraHandlerFields.join(", ")}, which adaptive hook lifting does not model yet.` };
  }

  const status = options.group.statusMessage;
  if (status !== undefined && typeof status !== "string") {
    return { reason: `${label} statusMessage must be a string to lift adaptively.` };
  }

  const name = `native-${options.event}-${options.groupIndex}`;
  const match = options.group.matcher;
  const frontmatter: JsonRecord = {
    events: [options.event],
    run: { command: handler.command },
    ...(match === undefined ? {} : { match }),
    ...(status === undefined ? {} : { status }),
  };
  return {
    item: {
      attachment: {
        event: options.event,
        hook: name,
        ...(match === undefined ? {} : { match }),
        scope: options.scope,
        sourcePath: options.path,
        ...(status === undefined ? {} : { status }),
      },
      definition: {
        events: [options.event],
        frontmatter,
        name,
        scriptReferences: [],
        scope: options.scope,
        sourcePath: options.path,
      },
      event: options.event,
    },
    reason: "",
  };
}

function codeForStatus(status: NativeHookLiftDiagnostic["status"]): NativeHookLiftDiagnosticCode {
  if (status === "native-only") return "native-hook-native-only";
  if (status === "unsupported") return "native-hook-unsupported";
  return "native-hook-runtime-unverified";
}

function messageForClassification(
  status: NativeHookLiftDiagnostic["status"],
  event: string,
  groupIndex: number,
  target: TargetName,
  reason: string | undefined
): string {
  if (status === "unknown") {
    return `Native hook ${event} group ${groupIndex} has a supported event/handler structure for ${target}, but command runtime semantics have not been verified; preserve native source and review its environment and payload contract before adaptation.`;
  }
  return reason ?? `Native hook ${event} group ${groupIndex} cannot be lifted adaptively for ${target}.`;
}
