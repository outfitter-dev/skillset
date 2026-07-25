const PROCESS_CLEANUP_GRACE_MS = 250;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export interface ProviderCommand {
  readonly cmd: readonly string[];
  readonly cwd: string;
}

export interface ProviderCommandExecutionOptions {
  readonly env: Record<string, string | undefined>;
  readonly maxStderrBytes?: number;
  readonly maxStdoutBytes?: number;
  readonly onOutput?: (
    stream: "stderr" | "stdout",
    text: string
  ) => Promise<void>;
  readonly onProcess?: (pid: number) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
  readonly timeoutMs: number;
}

export interface ProviderCommandExecutionResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stderrBytes: number;
  readonly stderrTruncated: boolean;
  readonly stdout: string;
  readonly stdoutBytes: number;
  readonly stdoutTruncated: boolean;
  readonly timedOut: boolean;
}

export class ProviderCommandError extends Error {
  readonly code: "EACCES" | "ENOENT";
  readonly kind: "missing_binary" | "unavailable_binary";

  constructor(kind: "missing_binary" | "unavailable_binary") {
    super("skillset: provider command executable is unavailable");
    this.code = kind === "missing_binary" ? "ENOENT" : "EACCES";
    this.kind = kind;
    this.name = "ProviderCommandError";
  }
}

/**
 * Executes an injected provider command without a shell. It drains both
 * streams after capture limits are reached so a noisy provider cannot stall.
 */
export async function runProviderCommand(
  command: ProviderCommand,
  options: ProviderCommandExecutionOptions
): Promise<ProviderCommandExecutionResult> {
  if (isAborted(options.signal)) throw abortError();

  const proc = spawnProviderCommand(command, options.env);

  let termination: Promise<void> | undefined;
  const scheduleTermination = (): Promise<void> => {
    if (termination !== undefined) return termination;
    termination = terminateProviderCommand(proc);
    void termination.catch(() => undefined);
    return termination;
  };
  const abort = () => {
    void scheduleTermination();
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  try {
    await throwIfAborted(options.signal, scheduleTermination);
    await options.onProcess?.(proc.pid);
    await throwIfAborted(options.signal, scheduleTermination);
    if (options.stdin !== undefined) proc.stdin.write(options.stdin);
    proc.stdin.end();
    timer =
      options.timeoutMs <= 0
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            void scheduleTermination();
          }, options.timeoutMs);

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      collectProviderCommandStream(
        "stdout",
        proc.stdout,
        options.maxStdoutBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        options.onOutput
      ),
      collectProviderCommandStream(
        "stderr",
        proc.stderr,
        options.maxStderrBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        options.onOutput
      ),
    ]);
    if (termination !== undefined) await termination;
    if (isAborted(options.signal)) throw abortError();
    completed = true;
    return {
      exitCode,
      stderr: stderr.text,
      stderrBytes: stderr.bytes,
      stderrTruncated: stderr.truncated,
      stdout: stdout.text,
      stdoutBytes: stdout.bytes,
      stdoutTruncated: stdout.truncated,
      timedOut,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (!completed) await scheduleTermination();
  }
}

export function isProviderCommandMissingBinary(
  error: unknown
): error is ProviderCommandError {
  return (
    error instanceof ProviderCommandError && error.kind === "missing_binary"
  );
}

export function isProviderCommandUnavailable(
  error: unknown
): boolean {
  return (
    error instanceof ProviderCommandError ||
    (error instanceof Error &&
      "code" in error &&
      ["EACCES", "ENOENT", "ENOEXEC", "ENOTDIR"].includes(String(error.code)))
  );
}

function spawnProviderCommand(
  command: ProviderCommand,
  env: Record<string, string | undefined>
) {
  if (command.cmd.length === 0) {
    throw new Error("skillset: provider command requires an executable");
  }
  try {
    return Bun.spawn([...command.cmd], {
      cwd: command.cwd,
      // Bun creates a POSIX session/process group and a detached Windows process.
      detached: true,
      env: cleanEnv(env),
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
      windowsHide: true,
    });
  } catch (error) {
    if (isMissingBinaryError(error)) {
      throw new ProviderCommandError("missing_binary");
    }
    if (isUnavailableBinaryError(error)) {
      throw new ProviderCommandError("unavailable_binary");
    }
    throw error;
  }
}

async function collectProviderCommandStream(
  streamName: "stderr" | "stdout",
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onOutput: ProviderCommandExecutionOptions["onOutput"]
): Promise<{
  readonly bytes: number;
  readonly text: string;
  readonly truncated: boolean;
}> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error(
      "skillset: provider command output limits must be non-negative safe integers"
    );
  }
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let bytes = 0;
  let retainedBytes = 0;
  let truncated = false;

  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    const remaining = maxBytes - retainedBytes;
    if (remaining > 0) {
      const retained = chunk.subarray(0, remaining);
      chunks.push(retained);
      retainedBytes += retained.byteLength;
      if (retained.byteLength < chunk.byteLength) truncated = true;
    } else if (chunk.byteLength > 0) {
      truncated = true;
    }

    const text = decoder.decode(chunk, { stream: true });
    if (text.length > 0) await onOutput?.(streamName, text);
  }
  const finalText = decoder.decode();
  if (finalText.length > 0) await onOutput?.(streamName, finalText);

  return {
    bytes,
    text: new TextDecoder().decode(joinChunks(chunks, retainedBytes)),
    truncated,
  };
}

function joinChunks(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function throwIfAborted(
  signal: AbortSignal | undefined,
  terminate: () => Promise<void>
): Promise<void> {
  if (!isAborted(signal)) return;
  await terminate();
  throw abortError();
}

async function terminateProviderCommand(
  proc: ReturnType<typeof Bun.spawn>
): Promise<void> {
  signalProviderCommandTree(proc, "SIGTERM");
  if (await providerCommandTreeExitsWithin(proc, PROCESS_CLEANUP_GRACE_MS)) {
    return;
  }
  signalProviderCommandTree(proc, "SIGKILL");
  // POSIX process-group probes also report dead zombies as present until an
  // external init process reaps them. SIGKILL cannot be ignored; once the
  // owned child exits, stream draining remains the completion boundary.
  await proc.exited;
}

async function providerCommandTreeExitsWithin(
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (providerCommandTreeExists(proc.pid)) {
    if (Date.now() >= deadline) return false;
    await Bun.sleep(5);
  }
  await proc.exited;
  return true;
}

function providerCommandTreeExists(pid: number): boolean {
  const target = process.platform === "win32" ? pid : -pid;
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

function signalProviderCommandTree(
  proc: ReturnType<typeof Bun.spawn>,
  signal: "SIGKILL" | "SIGTERM"
): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
      stderr: "ignore",
      stdout: "ignore",
    });
    return;
  }
  try {
    process.kill(-proc.pid, signal);
  } catch {
    proc.kill(signal);
  }
}

function cleanEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

function isMissingBinaryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isUnavailableBinaryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["EACCES", "ENOEXEC", "ENOTDIR"].includes(String(error.code))
  );
}

function isMissingProcessError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function abortError(): Error {
  return new DOMException("Runtime probe cancelled", "AbortError");
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}
