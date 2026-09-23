import { readFile } from "node:fs/promises";

export const DEFAULT_PROCESS_GONE_WITHIN_MS = 1_000;
const PROCESS_GONE_POLL_MS = 5;

export async function expectProcessGone(
  pid: number,
  opts?: { readonly withinMs?: number }
): Promise<void> {
  // Linux may report a descendant as running briefly after group SIGKILL and
  // the direct parent's exit; poll until ESRCH or the deadline without
  // masking a genuine survivor. A 500-iteration Linux probe reproduced the
  // immediate-observation race (47 transient running states, all dead within
  // 5 ms); see SET-633 / outfitter-dev/skillset#468.
  const withinMs = opts?.withinMs ?? DEFAULT_PROCESS_GONE_WITHIN_MS;
  const deadline = performance.now() + withinMs;
  while (await processIsRunning(pid)) {
    if (performance.now() >= deadline) {
      throw new Error(`process ${pid} is still running after ${withinMs}ms`);
    }
    await Bun.sleep(PROCESS_GONE_POLL_MS);
  }
}

async function processIsRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
  if (process.platform !== "linux") return true;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return (
      stat.slice(stat.lastIndexOf(") ") + 2, stat.lastIndexOf(") ") + 3) !== "Z"
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ESRCH")
    ) {
      return false;
    }
    throw error;
  }
}
