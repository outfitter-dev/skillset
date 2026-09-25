import { createHash } from "node:crypto";

import type {
  SourceDraftedLedgerPayload,
  SourceMovedLedgerPayload,
  SourcePromotedLedgerPayload,
} from "./change-ledger";
import { jsonlTailTimestamp, nextJsonlTimestamp } from "./change-ledger-write";

/** A source lifecycle event planned before its ledger record exists. */
export type SourceLifecycleLedgerEvent =
  | { readonly payload: SourceDraftedLedgerPayload; readonly type: "source.drafted" }
  | { readonly payload: SourceMovedLedgerPayload; readonly type: "source.moved" }
  | { readonly payload: SourcePromotedLedgerPayload; readonly type: "source.promoted" };

/**
 * Build the ledger record for a lifecycle event from the ledger bytes read at
 * apply time. The id binds the event to the stream it extends; the timestamp
 * is `max(now, tail)` so the append never inverts the current tail.
 */
export function sourceLifecycleLedgerRecord(
  current: string,
  event: SourceLifecycleLedgerEvent,
  nowMs = Date.now()
): object {
  const id = `${event.type.replace(".", "-")}-${createHash("sha256")
    .update(current)
    .update("\0")
    .update(event.type)
    .update("\0")
    .update(JSON.stringify(event.payload))
    .digest("hex")}`;
  return {
    createdAt: nextJsonlTimestamp(jsonlTailTimestamp(current), nowMs),
    id,
    payload: event.payload,
    schemaVersion: 1,
    type: event.type,
  };
}
