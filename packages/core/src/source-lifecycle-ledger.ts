import { randomUUID } from "node:crypto";

import type {
  SourceDraftDiscardedLedgerPayload,
  SourceDraftedLedgerPayload,
  SourceMovedLedgerPayload,
  SourcePromotedLedgerPayload,
} from "./change-ledger";
import { jsonlTailTimestamp, nextJsonlTimestamp } from "./change-ledger-write";
import {
  pendingLedgerEventFileName,
  readChangeLedgerTailTimestampAt,
} from "./pending-ledger-events";
import type { WorkspaceTransactionAppend } from "./workspace-transaction";

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
 * same command from the same trunk ledger write distinct records, and a merge
 * of both must stay readable (ids are unique ledger-wide).
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

/**
 * A workspace-transaction append that records a lifecycle event in its own
 * pending ledger event file (ADR-0045). The record is stamped against the
 * latest event time across `ledger.jsonl` and every pending file, and the file
 * is named from that stamp and the record's id.
 */
export function sourceLifecyclePendingAppend(
  rootPath: string,
  eventsDir: string,
  event: SourceLifecycleLedgerEvent
): WorkspaceTransactionAppend {
  return {
    newFile: {
      current: async () => {
        const tail = await readChangeLedgerTailTimestampAt(rootPath, eventsDir);
        // `sourceLifecycleLedgerRecord` reads only the tail's timestamp.
        return tail === undefined ? "" : `${JSON.stringify({ createdAt: tail })}\n`;
      },
      fileName: (records) => {
        const [record] = records as readonly { readonly createdAt: string; readonly id: string }[];
        if (record === undefined || records.length !== 1) {
          throw new Error("skillset: a lifecycle pending event file holds exactly one record");
        }
        return pendingLedgerEventFileName(record.createdAt, record.id);
      },
    },
    path: eventsDir,
    records: (current) => [sourceLifecycleLedgerRecord(current, event)],
  };
}
