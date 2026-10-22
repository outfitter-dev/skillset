import { randomUUID } from "node:crypto";

import type {
  SourceDraftDiscardedLedgerPayload,
  SourceDraftedLedgerPayload,
  SourceMovedLedgerPayload,
  SourcePromotedLedgerPayload,
} from "./change-ledger";
import { jsonlTailTimestamp, nextJsonlTimestamp } from "./change-ledger-write";

/** A source lifecycle event planned before its ledger record exists. */
export type SourceLifecycleLedgerEvent =
  | { readonly payload: SourceDraftDiscardedLedgerPayload; readonly type: "source.draft-discarded" }
  | { readonly payload: SourceDraftedLedgerPayload; readonly type: "source.drafted" }
  | { readonly payload: SourceMovedLedgerPayload; readonly type: "source.moved" }
  | { readonly payload: SourcePromotedLedgerPayload; readonly type: "source.promoted" };

/**
 * Build the ledger record for a lifecycle event from the ledger bytes read at
 * apply time. The timestamp is `max(now, tail)` so the append never inverts the
 * current tail. Every id is minted per invocation: two branches running the
 * same command from the same trunk ledger append distinct lines, and a union
 * merge of both must stay readable (ids are unique ledger-wide).
 */
export function sourceLifecycleLedgerRecord(
  current: string,
  event: SourceLifecycleLedgerEvent,
  nowMs = Date.now()
): object {
  return {
    createdAt: nextJsonlTimestamp(jsonlTailTimestamp(current), nowMs),
    id: `${event.type.replace(".", "-")}-${randomUUID()}`,
    payload: event.payload,
    schemaVersion: 1,
    type: event.type,
  };
}
