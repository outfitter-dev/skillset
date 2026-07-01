import {
  classifyAdaptiveHookIntent,
  type AdaptiveHookIntentStatus,
  type AdaptiveHookRenderSurface,
} from "./adaptive-hook-classifier";
import type { ResolvedAdaptiveHookAttachment } from "./adaptive-hook-attachments";
import type { AdaptiveHookScope, JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export type NativeHookLiftDiagnosticCode =
  | "native-hook-lift-candidate"
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
  readonly status: AdaptiveHookIntentStatus;
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
  if (!isJsonRecord(options.parsed)) return [];
  const events = isJsonRecord(options.parsed.hooks) ? options.parsed.hooks : options.parsed;
  const surface = options.surface ?? "plugin";
  const diagnostics: NativeHookLiftDiagnostic[] = [];

  for (const [event, groups] of Object.entries(events)) {
    if (events === options.parsed && event === "hooks") continue;
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, groupIndex) => {
      const path = `${options.sourcePath}#/${event}/${groupIndex}`;
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
        diagnostics.push({
          code: codeForStatus(classification.status),
          event,
          groupIndex,
          matcherEvaluation: classification.matcherEvaluation,
          matcherKind: classification.matcherKind,
          message: messageForClassification(classification.status, event, groupIndex, target, classification.reason),
          path,
          providerRef: classification.providerRef,
          status: classification.status,
          target,
        });
      }
    });
  }

  return diagnostics;
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

function codeForStatus(status: AdaptiveHookIntentStatus): NativeHookLiftDiagnosticCode {
  if (status === "native-only") return "native-hook-native-only";
  if (status === "unsupported") return "native-hook-unsupported";
  return "native-hook-lift-candidate";
}

function messageForClassification(
  status: AdaptiveHookIntentStatus,
  event: string,
  groupIndex: number,
  target: TargetName,
  reason: string | undefined
): string {
  if (status === "lossless-adaptive" || status === "provider-scoped-adaptive") {
    return `Native hook ${event} group ${groupIndex} can be represented as ${status} for ${target}; import preserves hooks/hooks.json until lift is explicit.`;
  }
  return reason ?? `Native hook ${event} group ${groupIndex} cannot be lifted adaptively for ${target}.`;
}
