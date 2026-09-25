import { createHash, randomBytes } from "node:crypto";

import {
  appendOwnedJsonlRecords,
  nextJsonlTimestamp,
  readJsonlTailTimestamp,
  rollbackOwnedJsonlRecords,
} from "@skillset/core/internal/change-ledger-write";
import type { ChangeLedgerEventType } from "@skillset/core/internal/change-ledger";
import { resolveInside } from "@skillset/core/internal/path";
import { prepareRepositoryMutationPath } from "@skillset/core/internal/repository-mutation";
import type { JsonRecord } from "@skillset/core/internal/types";
import { workspaceChangeFile } from "@skillset/core";

import {
  withChangeLedgerLock,
  type ChangeLedgerLockOptions,
} from "./change-ledger-lock";

export type { ChangeLedgerLockOptions } from "./change-ledger-lock";

export interface ChangeLedgerEventInput {
  readonly payload: JsonRecord;
  readonly type: ChangeLedgerEventType;
}

export interface ChangeLedgerMutation {
  readonly appendJsonl: (
    relativePath: string,
    records: readonly object[]
  ) => Promise<readonly string[]>;
  readonly appendLedger: (
    events: readonly ChangeLedgerEventInput[]
  ) => Promise<readonly string[]>;
  readonly assertOwned: () => Promise<void>;
}

/**
 * One owner-fenced mutation boundary for every production change-ledger writer.
 * The lock is held across read, plan, append, and rollback. Failure removes
 * only the JSONL records this transaction appended.
 */
export async function withChangeLedgerMutation<T>(
  rootPath: string,
  sourceDir: string | undefined,
  input: ChangeLedgerLockOptions | undefined,
  operation: (mutation: ChangeLedgerMutation) => Promise<T>
): Promise<T> {
  return withChangeLedgerLock(rootPath, sourceDir, input, async (lock) => {
    const owned = new Map<string, Set<string>>();
    const mutation: ChangeLedgerMutation = {
      assertOwned: lock.assertOwned,
      appendJsonl: async (relativePath, records) => {
        await lock.assertOwned();
        const absolutePath = resolveInside(rootPath, relativePath);
        await prepareRepositoryMutationPath(rootPath, absolutePath);
        const lines = await appendOwnedJsonlRecords(absolutePath, records);
        const current = owned.get(relativePath) ?? new Set<string>();
        for (const line of lines) current.add(line);
        owned.set(relativePath, current);
        return lines;
      },
      appendLedger: async (events) => {
        const relativePath = workspaceChangeFile(sourceDir, "ledger.jsonl");
        const absolutePath = resolveInside(rootPath, relativePath);
        const createdAt = nextJsonlTimestamp(await readJsonlTailTimestamp(absolutePath));
        return mutation.appendJsonl(
          relativePath,
          events.map((event) => ({
            createdAt,
            id: ledgerEventId(event.type),
            payload: event.payload,
            schemaVersion: 1,
            type: event.type,
          }))
        );
      },
    };

    try {
      return await operation(mutation);
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const [relativePath, lines] of owned) {
        try {
          await rollbackOwnedJsonlRecords(resolveInside(rootPath, relativePath), lines);
        } catch (rollbackError) {
          rollbackFailures.push(`${relativePath}: ${errorMessage(rollbackError)}`);
        }
      }
      if (rollbackFailures.length > 0) {
        throw new Error(
          `skillset: change-ledger mutation failed and rollback failed for ${rollbackFailures.join("; ")}; original error: ${errorMessage(error)}`,
          { cause: error }
        );
      }
      throw error;
    }
  });
}

function ledgerEventId(type: ChangeLedgerEventType): string {
  const hash = createHash("sha256");
  hash.update(type);
  hash.update("\0");
  hash.update(String(Date.now()));
  hash.update("\0");
  hash.update(randomBytes(16));
  return `evt-${hash.digest("hex").slice(0, 16)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
