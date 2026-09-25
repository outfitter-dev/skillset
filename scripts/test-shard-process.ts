import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { basename } from "node:path";

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly wallMs: number;
}

const terminationTasks = new WeakMap<ChildProcess, Promise<Error | null>>();

export async function runRequired(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  log: string,
  timeoutMs: number,
  signal: AbortSignal,
  append = false
): Promise<void> {
  const result = await runProcess(
    command,
    args,
    cwd,
    env,
    log,
    timeoutMs,
    signal,
    append
  );
  if (result.exitCode !== 0 || result.timedOut || result.signal) {
    throw new Error(
      `${basename(command)} setup failed (exit ${result.exitCode}, signal ${result.signal}, timedOut ${result.timedOut}); see ${log}`
    );
  }
}

export async function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  log: string,
  timeoutMs: number,
  signal: AbortSignal,
  append = false
): Promise<ProcessResult> {
  if (signal.aborted)
    throw new Error(`${basename(command)} canceled before launch`);
  const fd = openSync(log, append ? "a" : "w");
  const start = performance.now();
  const child = spawn(command, [...args], {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  const onAbort = () => killProcess(child, abortSignalName(signal));
  signal.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  let closed = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcess(child, "SIGTERM");
  }, timeoutMs);
  try {
    const result = await new Promise<ProcessResult>((resolveResult, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, exitSignal) => {
        closed = true;
        resolveResult({
          exitCode,
          signal: exitSignal,
          timedOut,
          wallMs: performance.now() - start,
        });
      });
    });
    const terminationError = await terminationTasks.get(child);
    if (terminationError) throw terminationError;
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    // A rejected wait must not leave the group running behind the caller.
    if (!closed) {
      killProcess(child, "SIGTERM");
      await terminationTasks.get(child);
    }
  }
}

/**
 * Runs tasks together under one controller. The first rejection aborts the
 * rest, and nothing returns or throws until every task has settled.
 */
export async function runAllOrAbort<T>(
  controller: AbortController,
  tasks: readonly (() => Promise<T>)[]
): Promise<T[]> {
  const settled = await Promise.allSettled(
    tasks.map(async (task) => {
      try {
        return await task();
      } catch (error) {
        controller.abort("SIGTERM");
        throw error;
      }
    })
  );
  const values: T[] = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") throw outcome.reason;
    values.push(outcome.value);
  }
  return values;
}

function abortSignalName(signal: AbortSignal): NodeJS.Signals {
  return signal.reason === "SIGINT" ? "SIGINT" : "SIGTERM";
}

function killProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (!pid || terminationTasks.has(child)) return;
  const task = (
    process.platform === "win32"
      ? terminateWindowsTree(pid)
      : terminatePosixGroup(pid, signal)
  ).then(
    () => null,
    (error: unknown) =>
      error instanceof Error ? error : new Error(String(error))
  );
  terminationTasks.set(child, task);
}

async function terminatePosixGroup(
  pid: number,
  signal: NodeJS.Signals
): Promise<void> {
  sendGroup(pid, signal);
  if (await waitForGroupExit(pid, 2000)) return;
  // The leader can exit before a descendant that ignores SIGTERM. Escalate
  // against the group, not the already-closed leader, and await its absence.
  sendGroup(pid, "SIGKILL");
  if (!(await waitForGroupExit(pid, 2000))) {
    throw new Error(`process group ${pid} survived SIGKILL`);
  }
}

async function terminateWindowsTree(pid: number): Promise<void> {
  const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
  });
  const code = await new Promise<number | null>((resolveCode, reject) => {
    killer.once("error", reject);
    killer.once("close", resolveCode);
  });
  // taskkill reports failure if the process tree already exited on its own.
  if (code !== 0) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    throw new Error(`taskkill could not terminate process tree ${pid}`);
  }
}

function sendGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Every process we launched has our uid. EPERM means this PGID is no
    // longer ours (usually fast reuse); never signal an unrelated group.
    if (code !== "ESRCH" && code !== "EPERM") throw error;
  }
}

async function waitForGroupExit(
  pid: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  do {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH" || code === "EPERM") return true;
      throw error;
    }
    await Bun.sleep(25);
  } while (performance.now() < deadline);
  return false;
}
