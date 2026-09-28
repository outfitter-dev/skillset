import type { ChangeLedgerEvent } from "./change-ledger";
import { compareStrings } from "./path";
import { sourceUnitSelector } from "./source-unit-selector";

export interface SourceIdentityMapping {
  readonly eventId: string;
  readonly eventIndex: number;
  readonly from: string;
  readonly to: string;
}

export function sourceIdentityMappings(
  events: readonly ChangeLedgerEvent[]
): readonly SourceIdentityMapping[] {
  return events.flatMap((event, eventIndex) => event.type === "source.moved"
    ? [{ eventId: event.id, eventIndex, from: event.payload.from, to: event.payload.to }]
    : []);
}

export function sourceMappingsAfterCursor(
  mappings: readonly SourceIdentityMapping[],
  cursor: string | null | undefined
): readonly SourceIdentityMapping[] {
  if (cursor === null || cursor === undefined) return mappings;
  const index = mappings.findIndex((mapping) => mapping.eventId === cursor);
  if (index < 0) throw new Error(`skillset: unknown source move cursor ${cursor}`);
  return mappings.slice(index + 1);
}

export function sourceMappingsAfterEvent(
  mappings: readonly SourceIdentityMapping[],
  eventIndex: number
): readonly SourceIdentityMapping[] {
  return mappings.filter((mapping) => mapping.eventIndex > eventIndex);
}

export function latestSourceMoveCursor(
  mappings: readonly SourceIdentityMapping[]
): string | null {
  return mappings.at(-1)?.eventId ?? null;
}

export function currentSourceIdentity(
  selector: string,
  mappings: readonly SourceIdentityMapping[]
): string {
  let current = sourceUnitSelector(selector);
  for (const mapping of mappings) {
    if (current === mapping.from) {
      current = mapping.to;
    }
  }
  return current;
}

export function currentSourceIdentities(
  selectors: readonly string[],
  mappings: readonly SourceIdentityMapping[]
): readonly string[] {
  return [
    ...new Set(
      selectors.map((selector) => currentSourceIdentity(selector, mappings))
    ),
  ].toSorted(compareStrings);
}

export function currentSourceHashEvidence(
  evidence: ReadonlyMap<string, readonly string[]>,
  mappings: readonly SourceIdentityMapping[]
): ReadonlyMap<string, readonly string[]> {
  const current = new Map<string, string[]>();
  for (const [selector, hashes] of evidence) {
    const mapped = currentSourceIdentity(selector, mappings);
    const values = current.get(mapped) ?? [];
    values.push(...hashes);
    current.set(mapped, values);
  }
  return new Map(
    [...current]
      .map(
        ([selector, hashes]) =>
          [selector, [...new Set(hashes)].toSorted(compareStrings)] as const
      )
      .toSorted(([left], [right]) => compareStrings(left, right))
  );
}

/** The pending reason a ledger event records evidence for, as the pending-change reader keys it. */
export function ledgerReasonId(event: ChangeLedgerEvent): string | undefined {
  if ("reasonId" in event.payload) return event.payload.reasonId;
  if (event.type === "change.amended") return event.payload.changeId;
  return undefined;
}

/**
 * Reasons whose ledger-recorded evidence currently names `selector`, following
 * later moves the way the pending-change reader folds ledger facts.
 */
export function ledgerReasonsNaming(
  events: readonly ChangeLedgerEvent[],
  selector: string
): ReadonlySet<string> {
  const mappings = sourceIdentityMappings(events);
  const reasons = new Set<string>();
  for (const [index, event] of events.entries()) {
    const reasonId = ledgerReasonId(event);
    if (reasonId === undefined) continue;
    const laterMoves = sourceMappingsAfterEvent(mappings, index);
    if (
      event.sourceUnits.some(
        (unit) =>
          unit.sourceHash !== undefined &&
          currentSourceIdentity(unit.selector, laterMoves) === selector
      )
    ) {
      reasons.add(reasonId);
    }
  }
  return reasons;
}
/* eslint-disable func-style -- Exported identity fold helpers are named for callers. */
