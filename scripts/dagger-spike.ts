/** Opt-in local comparison. No Cloud, workflow, or required-check integration. */
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { commandVerdict, verifyCommandEvidence } from "./dagger-capture";
import { parseJunitEvidence } from "./test-shard-evidence";

const ENGINE = {
  arm64:
    "registry.dagger.io/engine@sha256:21970e4d184a5dd63001252ca6bc16c59f90c87002f143fea534455d5899a8e7",
  x64: "registry.dagger.io/engine@sha256:26d90bdc6f04bb00494ab7af3696436112aa939702775af77428e6a6ee922461",
};
const VERSION = "v1.0.0-beta.21";
type Mode = "serial" | "sharded" | "focused";
interface Options {
  bundle: string;
  revision: string;
  image: string;
  platform: string;
  out: string;
  backend: "dagger" | "docker";
  mode: Mode;
  runKey: string;
  cli: string;
  reference: string | null;
  timings: string | null;
  file: string | null;
  runtimeTar: string | null;
}

export function spikeOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  const allowed = new Set([
    "bundle",
    "revision",
    "image",
    "platform",
    "out",
    "backend",
    "mode",
    "run-key",
    "cli",
    "reference",
    "timings",
    "file",
    "runtime-tar",
  ]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (!key || !allowed.has(key) || !value || flags.has(key))
      throw new Error("invalid or duplicate option");
    flags.set(key, value);
  }
  const required = (key: string) => {
    const value = flags.get(key);
    if (!value) throw new Error(`--${key} required`);
    return value;
  };
  const revision = required("revision");
  const image = required("image");
  const mode = required("mode");
  const backend = flags.get("backend") ?? "dagger";
  const platform = required("platform");
  if (!/^[0-9a-f]{40}$/.test(revision))
    throw new Error("full revision SHA required");
  if (
    !(flags.has("runtime-tar")
      ? /^sha256:[0-9a-f]{64}$/.test(image)
      : /@sha256:[0-9a-f]{64}$/.test(image))
  )
    throw new Error("runtime image digest required");
  if (!["serial", "sharded", "focused"].includes(mode))
    throw new Error("invalid mode");
  if (!["dagger", "docker"].includes(backend))
    throw new Error("invalid backend");
  if (!["linux/arm64", "linux/amd64"].includes(platform))
    throw new Error("explicit Linux platform required");
  if (mode === "sharded" && !flags.has("reference"))
    throw new Error("shards need their own environment's serial reference");
  if (mode === "focused" && !flags.has("file"))
    throw new Error("focused mode requires a tracked test file");
  return {
    bundle: resolve(required("bundle")),
    revision,
    image,
    platform,
    out: resolve(required("out")),
    backend: backend as Options["backend"],
    mode: mode as Mode,
    runKey: flags.get("run-key") ?? "stable",
    cli: flags.get("cli") ?? "dagger",
    reference: flags.has("reference") ? resolve(flags.get("reference")!) : null,
    timings: flags.has("timings") ? resolve(flags.get("timings")!) : null,
    file: flags.get("file") ?? null,
    runtimeTar: flags.has("runtime-tar")
      ? resolve(flags.get("runtime-tar")!)
      : null,
  };
}

const PREPARE = `set -euo pipefail
test "$(bun --version)" = 1.4.0
mkdir -p /out /inputs /work
git clone --quiet --no-hardlinks --no-tags /inputs/repo.bundle /work/repo
cd /work/repo
git checkout --quiet --detach "$SPIKE_REV"
test "$(git rev-parse HEAD)" = "$SPIKE_REV"
test -z "$(git status --porcelain --untracked-files=normal)"
bun install --frozen-lockfile
`;

export function testScript(mode: Mode, frozenTimings: boolean): string {
  if (mode === "sharded")
    return `set -euo pipefail
bun scripts/test-shards.ts --repo /work/repo --timings /out/artifacts/timings.json \\
  --baseline-junit /out/artifacts/baseline.xml --baseline-report /out/artifacts/baseline-report.json \\
  --out /out/shards --shards 2
`;
  if (mode === "focused")
    return `set -euo pipefail
git ls-files --error-unmatch "$SPIKE_FILE" >/dev/null
mkdir -p /out/artifacts
bun run test:sandbox -- bun test --timeout 15000 --reporter=junit \\
  --reporter-outfile=/out/artifacts/focused.xml "$SPIKE_FILE"
`;
  return `set -euo pipefail
mkdir -p /out/artifacts/measure
${frozenTimings ? "cp /inputs/timings.json /out/artifacts/timings.json" : ""}
mapfile -d '' tests < <(git ls-files -z 'apps/**/*.test.ts' 'packages/**/*.test.ts' 'scripts/**/*.test.ts')
test "\${#tests[@]}" -gt 0
printf '%s\\0' "\${tests[@]}" > /out/artifacts/manifest.nul
bun scripts/measure-gate.ts --label serial --out /out/artifacts/measure \\
  --output /out/artifacts/baseline.xml -- bun run test:sandbox -- bun test --timeout 15000 \\
  --timings=/out/artifacts/timings.json ${frozenTimings ? "" : "--update-timings"} \\
  --reporter=junit --reporter-outfile=/out/artifacts/baseline.xml "\${tests[@]}"
reports=(/out/artifacts/measure/*.json)
test "\${#reports[@]}" -eq 1
cp "\${reports[0]}" /out/artifacts/baseline-report.json
bun -e 'import {loadShardContract} from "./scripts/test-shard-contract"; await loadShardContract({repo:"/work/repo",timings:"/out/artifacts/timings.json",baselineJunit:"/out/artifacts/baseline.xml",baselineReport:"/out/artifacts/baseline-report.json"})'
`;
}

const q = JSON.stringify;
async function query<T>(document: string): Promise<T> {
  const port = process.env.DAGGER_SESSION_PORT;
  const token = process.env.DAGGER_SESSION_TOKEN;
  if (!port || !/^\d+$/.test(port) || !token)
    throw new Error("missing Dagger API session");
  const response = await fetch(`http://127.0.0.1:${port}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
    },
    body: JSON.stringify({ query: document }),
  });
  const result = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (!response.ok || result.errors?.length || !result.data)
    throw new Error(
      result.errors?.map((e) => e.message).join("\n") ??
        `API HTTP ${response.status}`
    );
  return result.data;
}

async function daggerRun(options: Options): Promise<void> {
  const file = async (path: string) =>
    (
      await query<{ host: { file: { id: string } } }>(
        `{host{file(path:${q(path)}){id}}}`
      )
    ).host.file.id;
  const steps = [
    `container(platform:${q(options.platform)})`,
    options.runtimeTar
      ? `import(source:${q(await file(options.runtimeTar))})`
      : `from(address:${q(options.image)})`,
    `withFile(path:"/inputs/repo.bundle",source:${q(await file(options.bundle))})`,
  ];
  for (const [name, value] of Object.entries(environment(options)))
    steps.push(`withEnvVariable(name:${q(name)},value:${q(value)})`);
  steps.push(
    `withExec(args:${q(["bash", "-c", PREPARE])},disableDaggerInDagger:true)`,
    `withWorkdir(path:"/work/repo")`
  );
  if (options.timings)
    steps.push(
      `withFile(path:"/inputs/timings.json",source:${q(await file(options.timings))})`
    );
  if (options.reference) {
    const reference = (
      await query<{ host: { directory: { id: string } } }>(
        `{host{directory(path:${q(options.reference)}){id}}}`
      )
    ).host.directory.id;
    steps.push(`withDirectory(path:"/out/artifacts",source:${q(reference)})`);
  }
  steps.push(
    `withEnvVariable(name:"SPIKE_RUN_KEY",value:${q(options.runKey)})`,
    `withNewFile(path:"/spike/test.sh",contents:${q(testScript(options.mode, !!options.timings))})`,
    `withExec(args:${q(["bun", "scripts/dagger-capture.ts", "/out/capture", "--", "bash", "/spike/test.sh"])},disableDaggerInDagger:true)`
  );
  const leaf = `directory(path:"/out"){export(path:${q(options.out)})}`;
  await query(
    `{${steps.reduceRight((inner, step) => `${step}{${inner}}`, leaf)}}`
  );
}

function environment(options: Options): Record<string, string> {
  return {
    CI: "1",
    TZ: "UTC",
    LANG: "C.UTF-8",
    SPIKE_REV: options.revision,
    SPIKE_FILE: options.file ?? "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function dockerRun(options: Options): Promise<void> {
  await mkdir(options.out);
  const script = `${options.out}.sh`;
  const capture =
    "bun scripts/dagger-capture.ts /out/capture -- bash /inputs/test.sh";
  await writeFile(script, testScript(options.mode, !!options.timings), {
    flag: "wx",
  });
  const args = [
    "docker",
    "run",
    "--rm",
    "--init",
    "--cpus=4",
    "--memory=8g",
    "--platform",
    options.platform,
    "--mount",
    `type=bind,source=${options.bundle},target=/inputs/repo.bundle,readonly`,
    "--mount",
    `type=bind,source=${script},target=/inputs/test.sh,readonly`,
    "--mount",
    `type=bind,source=${options.out},target=/out`,
  ];
  if (options.timings)
    args.push(
      "--mount",
      `type=bind,source=${options.timings},target=/inputs/timings.json,readonly`
    );
  if (options.reference)
    args.push(
      "--mount",
      `type=bind,source=${options.reference},target=/out/artifacts,readonly`
    );
  for (const [name, value] of Object.entries(environment(options)))
    args.push("--env", `${name}=${value}`);
  args.push(options.image, "bash", "-c", `${PREPARE}\n${capture}`);
  const child = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0)
    throw new Error("container setup/capture failed; no test verdict assumed");
}

async function main(): Promise<number> {
  const options = spikeOptions(process.argv.slice(2));
  if (process.env.DAGGER_SESSION_PORT) {
    await daggerRun(options);
    return 0; // Outer process verifies evidence after the CLI session/export ends.
  }
  if (await lstat(options.out).catch(() => null))
    throw new Error("output already exists");
  await realpath(dirname(options.out));
  const refs = Bun.spawnSync({
    cmd: ["git", "bundle", "list-heads", options.bundle],
    env: gitSafeEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (
    refs.exitCode !== 0 ||
    !refs.stdout
      .toString()
      .split("\n")
      .some((line) => line.split(" ")[0] === options.revision)
  )
    throw new Error("revision is not an advertised bundle reference");
  const bundleHash = createHash("sha256")
    .update(await readFile(options.bundle))
    .digest("hex");
  const runtimeTarHash = options.runtimeTar
    ? createHash("sha256")
        .update(await readFile(options.runtimeTar))
        .digest("hex")
    : null;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  let error: string | null = null;
  let verdict = 1;
  try {
    if (options.backend === "docker") await dockerRun(options);
    else {
      const version = Bun.spawnSync([options.cli, "version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (
        version.exitCode !== 0 ||
        !version.stdout.toString().includes(`version:     ${VERSION}\n`)
      )
        throw new Error(`verified ${VERSION} CLI required`);
      const engine = ENGINE[process.arch as keyof typeof ENGINE];
      if (!engine) throw new Error("unsupported engine host architecture");
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        DAGGER_ENGINE: `image://${engine}`,
        DAGGER_NO_NAG: "1",
        DAGGER_NO_UPDATE_CHECK: "1",
      };
      delete env.DAGGER_CLOUD_TOKEN;
      delete env.DAGGER_CLOUD_ENGINE;
      const log = openSync(`${options.out}.engine.log`, "wx");
      const child = Bun.spawn(
        [
          options.cli,
          "-m",
          "core",
          "api",
          "with-session",
          process.execPath,
          import.meta.path,
          ...process.argv.slice(2),
        ],
        { env, stdout: log, stderr: log }
      );
      closeSync(log);
      const code = await child.exited;
      if (code !== 0)
        throw new Error(
          `Dagger session/export failed (exit ${code}, signal ${child.signalCode}); see ${options.out}.engine.log; no test verdict assumed`
        );
    }
    const evidence = await verifyCommandEvidence(join(options.out, "capture"));
    verdict = commandVerdict(evidence);
    if (verdict === 0 && options.mode === "focused") {
      const junit = parseJunitEvidence(
        await readFile(join(options.out, "artifacts/focused.xml"), "utf8"),
        "/work/repo"
      );
      if (
        junit.failures !== 0 ||
        junit.files.length !== 1 ||
        junit.files[0] !== options.file
      )
        throw new Error("focused JUnit does not prove the requested file");
    }
    if (verdict === 0 && options.mode === "sharded") {
      const aggregate = JSON.parse(
        await readFile(join(options.out, "shards/aggregate.json"), "utf8")
      );
      if (aggregate.status !== "passed")
        throw new Error("missing successful shard union");
    }
  } catch (cause) {
    verdict = 1;
    error = cause instanceof Error ? cause.message : String(cause);
  }
  await writeFile(
    `${options.out}.invocation.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        ...options,
        bundleHash,
        runtimeTarHash,
        startedAt,
        endedAt: new Date().toISOString(),
        outerWallMs: performance.now() - started,
        processWallMs: process.uptime() * 1000,
        hostPlatform: process.platform,
        hostArch: process.arch,
        resourceAccounting: "unavailable",
        verdict,
        error,
      },
      null,
      2
    )}\n`,
    { flag: "wx" }
  );
  if (error) console.error(error);
  return verdict;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
