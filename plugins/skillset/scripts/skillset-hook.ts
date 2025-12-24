/**
 * Plugin hook entrypoint for skillset.
 *
 * Default behavior: invoke the CLI (`skillset hook`) if available.
 * Fallback: import the core hook runner for local monorepo development.
 */

type HookRunner = (stdin: string) => Promise<string>;

const HOOK_MODE = process.env.SKILLSET_HOOK_MODE?.toLowerCase();

async function loadHookRunner(): Promise<HookRunner> {
  if (HOOK_MODE === "cli") {
    return runHookViaCli;
  }
  if (HOOK_MODE === "module") {
    const runner = await loadModuleRunner();
    if (!runner) {
      throw new Error("skillset hook: module runner unavailable");
    }
    return runner;
  }

  const cliPath = resolveCliPath();
  if (cliPath) {
    return runHookViaCli;
  }

  const runner = await loadModuleRunner();
  if (runner) {
    return runner;
  }

  throw new Error("skillset hook: no CLI or module runner available");
}

async function loadModuleRunner(): Promise<HookRunner | null> {
  try {
    const mod = await import("@skillset/core");
    if (typeof mod.runUserPromptSubmitHook === "function") {
      return mod.runUserPromptSubmitHook;
    }
  } catch {
    // ignore and fall through
  }

  try {
    const mod = await import("../../../packages/core/src/hooks/hook-runner.ts");
    return mod.runUserPromptSubmitHook;
  } catch {
    return null;
  }
}

function resolveCliPath(): string | null {
  if (typeof Bun.which === "function") {
    return Bun.which("skillset");
  }
  return null;
}

async function runHookViaCli(stdin: string): Promise<string> {
  const cliPath = resolveCliPath();
  if (!cliPath) {
    throw new Error("skillset hook: CLI not found in PATH");
  }

  const proc = Bun.spawn([cliPath, "hook"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  await writeToStdin(proc.stdin, stdin);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `skillset hook: CLI exited with ${exitCode}${stderr ? `: ${stderr}` : ""}`
    );
  }

  return stdout;
}

async function writeToStdin(
  stream: ReadableStream<Uint8Array> | WritableStream<Uint8Array> | null,
  input: string
): Promise<void> {
  if (!stream) {
    return;
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const writable = stream as WritableStream<Uint8Array>;
  if (typeof writable.getWriter === "function") {
    const writer = writable.getWriter();
    await writer.write(data);
    await writer.close();
    return;
  }
  const nodeStream = stream as unknown as {
    write?: (chunk: Uint8Array) => void;
    end?: () => void;
  };
  if (nodeStream.write) {
    nodeStream.write(data);
    nodeStream.end?.();
  }
}

async function main() {
  const runUserPromptSubmitHook = await loadHookRunner();
  const stdin = await Bun.stdin.text();
  const output = await runUserPromptSubmitHook(stdin);
  console.log(output);
}

main();
