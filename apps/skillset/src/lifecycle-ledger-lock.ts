import type { SkillsetOptions } from "@skillset/core/internal/types";

import { detectWorkspaceOptions } from "./change-status";
import { withChangeLedgerLock, type ChangeLedgerLockOptions } from "./change-ledger-lock";

export type { ChangeLedgerLockOptions } from "./change-ledger-lock";

/** Runs a lifecycle command's plan and apply under the change-ledger lock. */
export type LifecycleLedgerLock = <T>(
  rootPath: string,
  operation: () => Promise<T>
) => Promise<T>;

/**
 * Run an applying source lifecycle command (`draft`, `promote`, `move`) under
 * the change-ledger lock. The command's own plan and apply both run inside it,
 * so a concurrent ledger writer cannot append between the final plan and the
 * transaction, and the transaction's owned append is serialized with them.
 */
export async function withLifecycleLedgerLock<T>(
  rootPath: string,
  lock: ChangeLedgerLockOptions | undefined,
  operation: () => Promise<T>
): Promise<T> {
  const options: SkillsetOptions = {};
  const { sourceDir } = await detectWorkspaceOptions(rootPath, options);
  return withChangeLedgerLock(rootPath, sourceDir, lock, async () => operation());
}

export const defaultLifecycleLedgerLock: LifecycleLedgerLock = (rootPath, operation) =>
  withLifecycleLedgerLock(rootPath, undefined, operation);
