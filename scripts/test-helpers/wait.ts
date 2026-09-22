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

export function reapOwnedProcess(process: {
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): void;
}): void {
  if (process.exitCode === null) {
    process.kill("SIGTERM");
  }
}
