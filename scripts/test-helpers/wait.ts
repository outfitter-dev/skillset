/* eslint-disable no-await-in-loop -- Deadline polls must observe the condition before sleeping. */

export type WaitForDeadlineOptions = {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
};

export type WaitForConditionOptions = WaitForDeadlineOptions & {
  readonly path?: string;
};

const DEFAULT_INTERVAL_MS = 10;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function waitForCondition(
  description: string,
  condition: () => boolean | Promise<boolean>,
  options: WaitForConditionOptions = {}
): Promise<void> {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    throw new Error("waitForCondition requires a description");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("waitForCondition timeoutMs must be a positive finite number");
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("waitForCondition intervalMs must be a positive finite number");
  }

  const deadline = performance.now() + timeoutMs;
  while (true) {
    if (await condition()) {
      return;
    }
    if (performance.now() >= deadline) {
      const pathSuffix = options.path === undefined ? "" : ` at ${options.path}`;
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${trimmed}${pathSuffix}`);
    }
    await Bun.sleep(intervalMs);
  }
}

export async function waitForPath(
  path: string,
  description: string,
  options: WaitForDeadlineOptions = {}
): Promise<void> {
  if (path.trim().length === 0) {
    throw new Error("waitForPath requires a path");
  }
  await waitForCondition(description, () => Bun.file(path).exists(), {
    ...options,
    path,
  });
}

/**
 * Wait until `path` holds one complete newline-terminated line of exactly
 * `count` positive integer pids, and return them.
 *
 * A shell redirection creates the file before the writer fills it, so file
 * existence alone can observe an empty or partial marker.
 */
export async function waitForPids(
  path: string,
  count: number,
  description: string,
  options: WaitForDeadlineOptions = {}
): Promise<number[]> {
  let pids: number[] = [];
  await waitForCondition(
    description,
    async () => {
      const file = Bun.file(path);
      if (!(await file.exists())) return false;
      const text = await file.text();
      if (!text.endsWith("\n")) return false;
      pids = text.trim().split(/\s+/u).map(Number);
      return pids.length === count && pids.every((pid) => Number.isSafeInteger(pid) && pid > 0);
    },
    { ...options, path }
  );
  return pids;
}

export type OwnedProcess = {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly exited: Promise<unknown>;
  kill(signal?: NodeJS.Signals | number): void;
};

const DEFAULT_REAP_GRACE_MS = 2_000;

/**
 * Stop a test-owned child and wait for it to exit.
 *
 * Sends SIGTERM only while the child is still running, waits up to `graceMs`
 * for it to exit, escalates to SIGKILL, and fails loudly if it still survives,
 * so a failing test never leaves its child running into sandbox cleanup.
 */
export async function reapOwnedProcess(
  child: OwnedProcess,
  options: { readonly graceMs?: number } = {}
): Promise<void> {
  const graceMs = options.graceMs ?? DEFAULT_REAP_GRACE_MS;
  if (child.exitCode !== null || child.signalCode !== null) {
    await child.exited;
    return;
  }
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    child.kill(signal);
    if (await exitsWithin(child, graceMs)) return;
  }
  throw new Error(`owned process ${child.pid} survived SIGKILL for ${graceMs}ms`);
}

async function exitsWithin(child: OwnedProcess, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([child.exited.then(() => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
