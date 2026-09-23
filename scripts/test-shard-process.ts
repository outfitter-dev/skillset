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
  active: Set<ChildProcess>,
  append = false
): Promise<void> {
  const result = await runProcess(
    command,
    args,
    cwd,
    env,
    log,
    timeoutMs,
    active,
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
  active: Set<ChildProcess>,
  append = false
): Promise<ProcessResult> {
  const fd = openSync(log, append ? "a" : "w");
  const start = performance.now();
  const child = spawn(command, [...args], {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  active.add(child);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcess(child, "SIGTERM");
  }, timeoutMs);
  try {
    const result = await new Promise<ProcessResult>((resolveResult, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) =>
        resolveResult({
          exitCode,
          signal,
          timedOut,
          wallMs: performance.now() - start,
        })
      );
    });
    const terminationError = await terminationTasks.get(child);
    if (terminationError) throw terminationError;
    return result;
  } finally {
    clearTimeout(timer);
    active.delete(child);
  }
}

export function killActive(
  active: ReadonlySet<ChildProcess>,
  signal: NodeJS.Signals
): void {
  for (const child of active) killProcess(child, signal);
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
