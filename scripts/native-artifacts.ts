import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import packageManifest from "../apps/skillset/package.json";
import {
  CLI_COMMANDS,
  CLI_LEAF_SUBCOMMANDS,
} from "../apps/skillset/src/cli-commands";
import {
  CLI_ENVIRONMENT,
  CLI_FLAGS,
  CLI_ROUTE_FLAGS,
  FINITE_JSON_ROUTES,
  HIDDEN_CLI_ROUTES,
  JSONL_ROUTES,
  STRUCTURED_OUTPUT_EXCEPTIONS,
} from "../apps/skillset/src/cli-contract";
import { createNativeArchive, extractNativeArchive } from "./native-archive";
import {
  NATIVE_TARGETS,
  REQUIRED_NATIVE_TARGETS,
  getNativeTarget,
  nativeArchiveName,
  type NativeTarget,
} from "./native-targets";

const defaultOutputDir = ".skillset/cache/native";
const sizeBaselinePath = join(import.meta.dir, "native-size-baseline.json");

export interface NativeArtifactRecord {
  readonly archive: string;
  readonly archiveSize: number;
  readonly npmPackage: string;
  readonly rawSize: number;
  readonly required: boolean;
  readonly sha256: string;
  readonly suffix: string;
  readonly target: string;
}

export interface NativeArtifactManifest {
  readonly artifacts: readonly NativeArtifactRecord[];
  readonly bunVersion: string;
  readonly cliContractSha256: string;
  readonly commit: string;
  readonly schemaVersion: 1;
  readonly version: string;
}

interface NativeSizeBaseline {
  readonly artifacts: readonly {
    readonly archiveSize: number;
    readonly rawSize: number;
    readonly suffix: string;
  }[];
  readonly bunVersion: string;
  readonly policy: {
    readonly minimumAllowanceBytes: number;
    readonly percent: number;
  };
  readonly schemaVersion: 1;
  readonly observedVersion: string;
}

export function parseNativeSizeBaseline(value: unknown): NativeSizeBaseline {
  if (!value || typeof value !== "object") {
    throw new Error("Native size baseline must be an object");
  }
  const baseline = value as Partial<NativeSizeBaseline>;
  if (
    baseline.schemaVersion !== 1 ||
    baseline.bunVersion !== Bun.version ||
    typeof baseline.observedVersion !== "string" ||
    baseline.observedVersion.length === 0 ||
    !baseline.policy ||
    !Number.isFinite(baseline.policy.percent) ||
    baseline.policy.percent <= 0 ||
    !Number.isSafeInteger(baseline.policy.minimumAllowanceBytes) ||
    baseline.policy.minimumAllowanceBytes <= 0 ||
    !Array.isArray(baseline.artifacts)
  ) {
    throw new Error(
      `Native size baseline must use schema 1, pinned Bun ${Bun.version}, and a positive growth policy`
    );
  }

  const knownSuffixes = new Set(NATIVE_TARGETS.map((target) => target.suffix));
  const baselineSuffixes: string[] = [];
  for (const entry of baseline.artifacts) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.suffix !== "string" ||
      !knownSuffixes.has(entry.suffix as NativeTarget["suffix"]) ||
      !Number.isSafeInteger(entry.rawSize) ||
      entry.rawSize <= 0 ||
      !Number.isSafeInteger(entry.archiveSize) ||
      entry.archiveSize <= 0
    ) {
      throw new Error("Native size baseline contains an invalid artifact");
    }
    baselineSuffixes.push(entry.suffix);
  }

  const requiredSuffixes = REQUIRED_NATIVE_TARGETS.map(
    (target) => target.suffix
  );
  if (
    new Set(baselineSuffixes).size !== baselineSuffixes.length ||
    requiredSuffixes.some((suffix) => !baselineSuffixes.includes(suffix))
  ) {
    throw new Error(
      "Native size baseline must cover every required target exactly once"
    );
  }
  return baseline as NativeSizeBaseline;
}

export interface BuildNativeArtifactsOptions {
  readonly commit?: string;
  readonly outputDir?: string | undefined;
  readonly reproducible?: boolean;
  readonly targets: readonly NativeTarget[];
}

export interface VerifyNativeArtifactsOptions {
  readonly allowPartial?: boolean;
  readonly allowReserved?: boolean;
  readonly outputDir?: string | undefined;
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function cliContractSha256(): string {
  return sha256(
    `${JSON.stringify({
      commands: CLI_COMMANDS,
      environment: CLI_ENVIRONMENT,
      finiteJsonRoutes: FINITE_JSON_ROUTES,
      flags: CLI_FLAGS,
      hiddenRoutes: HIDDEN_CLI_ROUTES,
      jsonlRoutes: JSONL_ROUTES,
      leafSubcommands: CLI_LEAF_SUBCOMMANDS,
      routeFlags: CLI_ROUTE_FLAGS,
      structuredOutputExceptions: STRUCTURED_OUTPUT_EXCEPTIONS,
    })}\n`
  );
}

export function nativeManifestName(version = packageManifest.version): string {
  return `skillset-v${version}-manifest.json`;
}

export function nativeChecksumsName(version = packageManifest.version): string {
  return `skillset-v${version}-SHA256SUMS`;
}

export function renderNativeManifest(manifest: NativeArtifactManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function renderNativeChecksums(
  entries: readonly { readonly name: string; readonly sha256: string }[]
): string {
  return `${[...entries]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.sha256}  ${entry.name}`)
    .join("\n")}\n`;
}

async function readCommit(): Promise<string> {
  const process = Bun.spawn(["git", "rev-parse", "HEAD"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Could not resolve native build commit: ${stderr.trim()}`);
  }
  return stdout.trim();
}

function assertSafeOutputDir(outputDir: string): string {
  const resolved = resolve(outputDir);
  const forbidden = new Set([resolve("/"), resolve("."), resolve(homedir())]);
  if (forbidden.has(resolved)) {
    throw new Error(`Refusing unsafe native output directory: ${resolved}`);
  }
  return resolved;
}

async function compileTarget(
  target: NativeTarget,
  executablePath: string
): Promise<void> {
  await mkdir(dirname(executablePath), { recursive: true });
  const childProcess = Bun.spawn(
    [
      process.execPath,
      "build",
      "apps/skillset/src/cli.ts",
      "--compile",
      "--minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      `--target=${target.bunTarget}`,
      `--outfile=${executablePath}`,
    ],
    { stderr: "pipe", stdout: "pipe" }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    childProcess.exited,
    new Response(childProcess.stdout).text(),
    new Response(childProcess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Native build failed for ${target.suffix} (${target.bunTarget}):\n${stdout}${stderr}`
    );
  }
  await adHocSignDarwinExecutable(target, executablePath);
}

async function adHocSignDarwinExecutable(
  target: NativeTarget,
  executablePath: string
): Promise<void> {
  if (!target.suffix.startsWith("darwin-")) {
    return;
  }
  if (process.platform !== "darwin") {
    throw new Error(
      `Native build for ${target.suffix} requires a macOS host for deterministic ad hoc code signing`
    );
  }
  // Bun 1.4.0 standalone compilation leaves an invalid embedded signature on
  // Darwin binaries. An ad hoc signature carries no developer identity and is
  // distinct from the protected signing/notarization release policy, but it is
  // required for the kernel to execute the compiled bytes.
  const childProcess = Bun.spawn(
    ["codesign", "--force", "--sign", "-", "--timestamp=none", executablePath],
    { stderr: "pipe", stdout: "pipe" }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    childProcess.exited,
    new Response(childProcess.stdout).text(),
    new Response(childProcess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Ad hoc code signing failed for ${target.suffix}:\n${stdout}${stderr}`
    );
  }
}

async function buildTarget(
  outputDir: string,
  target: NativeTarget,
  reproducible: boolean
): Promise<NativeArtifactRecord> {
  const workRoot = join(outputDir, ".work", target.suffix);
  const primary = join(workRoot, "primary", target.executable);
  await compileTarget(target, primary);
  const primaryBytes = new Uint8Array(await readFile(primary));

  if (reproducible) {
    const repeat = join(workRoot, "repeat", target.executable);
    await compileTarget(target, repeat);
    const repeatBytes = new Uint8Array(await readFile(repeat));
    const primaryHash = sha256(primaryBytes);
    const repeatHash = sha256(repeatBytes);
    if (primaryHash !== repeatHash) {
      throw new Error(
        `Native build is not reproducible for ${target.suffix}: ${primaryHash} != ${repeatHash}`
      );
    }
  }

  const executablePath = join(
    outputDir,
    "bin",
    target.suffix,
    target.executable
  );
  await mkdir(dirname(executablePath), { recursive: true });
  await copyFile(primary, executablePath);
  if (target.executable !== "skillset.exe") await chmod(executablePath, 0o755);

  const archive = createNativeArchive(
    target.archiveKind,
    target.executable,
    primaryBytes
  );
  const archiveName = nativeArchiveName(packageManifest.version, target);
  await writeFile(join(outputDir, archiveName), archive);

  return {
    archive: archiveName,
    archiveSize: archive.byteLength,
    npmPackage: target.npmPackage,
    rawSize: primaryBytes.byteLength,
    required: target.required,
    sha256: sha256(archive),
    suffix: target.suffix,
    target: target.bunTarget,
  };
}

export async function buildNativeArtifacts(
  options: BuildNativeArtifactsOptions
): Promise<NativeArtifactManifest> {
  const outputDir = assertSafeOutputDir(options.outputDir ?? defaultOutputDir);
  const targets = [...options.targets].sort((left, right) =>
    left.suffix.localeCompare(right.suffix)
  );
  if (targets.length === 0)
    throw new Error("Select at least one native target");
  if (new Set(targets.map((target) => target.suffix)).size !== targets.length) {
    throw new Error("Native build target selection contains duplicates");
  }

  await rm(join(outputDir, ".work"), { force: true, recursive: true });
  await rm(join(outputDir, "bin"), { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    ...NATIVE_TARGETS.map((target) =>
      rm(join(outputDir, nativeArchiveName(packageManifest.version, target)), {
        force: true,
      })
    ),
    rm(join(outputDir, nativeManifestName()), { force: true }),
    rm(join(outputDir, nativeChecksumsName()), { force: true }),
  ]);

  const artifacts: NativeArtifactRecord[] = [];
  for (const target of targets) {
    console.error(`skillset: building native target ${target.suffix}`);
    artifacts.push(
      await buildTarget(outputDir, target, options.reproducible ?? false)
    );
  }

  const manifest: NativeArtifactManifest = {
    artifacts,
    bunVersion: Bun.version,
    cliContractSha256: cliContractSha256(),
    commit: options.commit ?? (await readCommit()),
    schemaVersion: 1,
    version: packageManifest.version,
  };
  const manifestText = renderNativeManifest(manifest);
  const manifestName = nativeManifestName();
  await writeFile(join(outputDir, manifestName), manifestText);
  await writeFile(
    join(outputDir, nativeChecksumsName()),
    renderNativeChecksums([
      ...artifacts.map((artifact) => ({
        name: artifact.archive,
        sha256: artifact.sha256,
      })),
      { name: manifestName, sha256: sha256(manifestText) },
    ])
  );
  await rm(join(outputDir, ".work"), { force: true, recursive: true });

  await verifyNativeArtifacts({
    allowPartial: !REQUIRED_NATIVE_TARGETS.every((requiredTarget) =>
      targets.some((target) => target.suffix === requiredTarget.suffix)
    ),
    allowReserved: targets.some((target) => !target.required),
    outputDir,
  });
  return manifest;
}

export function parseNativeManifest(value: unknown): NativeArtifactManifest {
  if (!value || typeof value !== "object")
    throw new Error("Native manifest must be an object");
  const expectedManifestFields = [
    "artifacts",
    "bunVersion",
    "cliContractSha256",
    "commit",
    "schemaVersion",
    "version",
  ] as const;
  const manifestFields = Object.keys(value).sort();
  if (
    JSON.stringify(manifestFields) !==
    JSON.stringify([...expectedManifestFields].sort())
  ) {
    throw new Error(
      `Native manifest fields must be exactly ${expectedManifestFields.join(", ")}`
    );
  }
  const candidate = value as Partial<NativeArtifactManifest>;
  if (candidate.schemaVersion !== 1) {
    throw new Error(
      `Unsupported native manifest schema version ${String(candidate.schemaVersion)}`
    );
  }
  for (const field of [
    "version",
    "commit",
    "bunVersion",
    "cliContractSha256",
  ] as const) {
    if (typeof candidate[field] !== "string" || candidate[field].length === 0) {
      throw new Error(`Native manifest is missing ${field}`);
    }
  }
  if (!Array.isArray(candidate.artifacts))
    throw new Error("Native manifest is missing artifacts");
  if (!/^[a-f0-9]{40}$/.test(candidate.commit ?? "")) {
    throw new Error(
      "Native manifest commit must be a lowercase 40-character Git SHA"
    );
  }
  if (!/^[a-f0-9]{64}$/.test(candidate.cliContractSha256 ?? "")) {
    throw new Error(
      "Native manifest CLI contract digest must be a lowercase SHA-256"
    );
  }
  const expectedArtifactFields = [
    "archive",
    "archiveSize",
    "npmPackage",
    "rawSize",
    "required",
    "sha256",
    "suffix",
    "target",
  ] as const;
  for (const [index, artifact] of candidate.artifacts.entries()) {
    if (!artifact || typeof artifact !== "object") {
      throw new Error(`Native manifest artifact ${index} must be an object`);
    }
    const artifactFields = Object.keys(artifact).sort();
    if (
      JSON.stringify(artifactFields) !==
      JSON.stringify([...expectedArtifactFields].sort())
    ) {
      throw new Error(
        `Native manifest artifact ${index} fields must be exactly ${expectedArtifactFields.join(", ")}`
      );
    }
    const record = artifact as Partial<NativeArtifactRecord>;
    for (const field of [
      "archive",
      "npmPackage",
      "suffix",
      "target",
    ] as const) {
      if (typeof record[field] !== "string" || record[field].length === 0) {
        throw new Error(
          `Native manifest artifact ${index} is missing ${field}`
        );
      }
    }
    if (!/^[a-f0-9]{64}$/.test(record.sha256 ?? "")) {
      throw new Error(
        `Native manifest artifact ${index} sha256 must be a lowercase SHA-256`
      );
    }
    for (const field of ["rawSize", "archiveSize"] as const) {
      if (!Number.isSafeInteger(record[field]) || (record[field] ?? 0) <= 0) {
        throw new Error(
          `Native manifest artifact ${index} ${field} must be a positive integer`
        );
      }
    }
    if (typeof record.required !== "boolean") {
      throw new Error(
        `Native manifest artifact ${index} required must be a boolean`
      );
    }
  }
  return candidate as NativeArtifactManifest;
}

async function validateSizePolicy(
  artifacts: readonly NativeArtifactRecord[]
): Promise<void> {
  const baseline = parseNativeSizeBaseline(
    JSON.parse(await readFile(sizeBaselinePath, "utf8"))
  );
  const bySuffix = new Map(
    baseline.artifacts.map((entry) => [entry.suffix, entry])
  );
  for (const artifact of artifacts) {
    const observed = bySuffix.get(artifact.suffix);
    if (!observed)
      throw new Error(`Native size baseline is missing ${artifact.suffix}`);
    for (const field of ["rawSize", "archiveSize"] as const) {
      const allowance = Math.max(
        baseline.policy.minimumAllowanceBytes,
        Math.ceil(observed[field] * (baseline.policy.percent / 100))
      );
      const limit = observed[field] + allowance;
      if (artifact[field] > limit) {
        throw new Error(
          `${artifact.suffix} ${field} is ${artifact[field]} bytes; baseline ${observed[field]} plus allowance permits ${limit}`
        );
      }
    }
  }
}

export async function verifyNativeArtifacts(
  options: VerifyNativeArtifactsOptions = {}
): Promise<NativeArtifactManifest> {
  const outputDir = assertSafeOutputDir(options.outputDir ?? defaultOutputDir);
  const manifestText = await readFile(
    join(outputDir, nativeManifestName()),
    "utf8"
  );
  const manifest = parseNativeManifest(JSON.parse(manifestText));
  if (manifest.version !== packageManifest.version) {
    throw new Error(
      `Native manifest version ${manifest.version} does not match ${packageManifest.version}`
    );
  }
  if (manifest.bunVersion !== Bun.version) {
    throw new Error(
      `Native manifest Bun ${manifest.bunVersion} does not match pinned runtime ${Bun.version}`
    );
  }
  if (manifest.cliContractSha256 !== cliContractSha256()) {
    throw new Error("Native manifest CLI contract digest is stale");
  }

  const expectedReleaseFiles = new Set([
    ...manifest.artifacts.map((artifact) => artifact.archive),
    nativeManifestName(),
    nativeChecksumsName(),
  ]);
  const unexpectedReleaseFiles = (await readdir(outputDir))
    .filter(
      (entry) =>
        entry.startsWith(`skillset-v${manifest.version}-`) &&
        !expectedReleaseFiles.has(entry)
    )
    .sort();
  if (unexpectedReleaseFiles.length > 0) {
    throw new Error(
      `Native output contains unexpected release artifacts: ${unexpectedReleaseFiles.join(", ")}`
    );
  }

  const suffixes = manifest.artifacts.map((artifact) => artifact.suffix);
  if (new Set(suffixes).size !== suffixes.length) {
    throw new Error("Native manifest contains duplicate artifact suffixes");
  }
  const sortedSuffixes = [...suffixes].sort((left, right) =>
    left.localeCompare(right)
  );
  if (JSON.stringify(suffixes) !== JSON.stringify(sortedSuffixes)) {
    throw new Error("Native manifest artifacts must be sorted by suffix");
  }

  const expectedRequired = REQUIRED_NATIVE_TARGETS.map(
    (target) => target.suffix
  ).sort();
  const actualRequired = manifest.artifacts
    .filter((artifact) => artifact.required)
    .map((artifact) => artifact.suffix)
    .sort();
  if (
    !options.allowPartial &&
    JSON.stringify(actualRequired) !== JSON.stringify(expectedRequired)
  ) {
    throw new Error(
      `Native manifest required set is incomplete: expected ${expectedRequired.join(", ")}; found ${actualRequired.join(", ")}`
    );
  }

  const checksums = new Map<string, string>();
  const checksumText = await readFile(
    join(outputDir, nativeChecksumsName()),
    "utf8"
  );
  const lines = checksumText.trimEnd().split("\n");
  const sortedLines = [...lines].sort((left, right) =>
    left.slice(66).localeCompare(right.slice(66))
  );
  if (JSON.stringify(lines) !== JSON.stringify(sortedLines)) {
    throw new Error("Native checksum inventory must be sorted by filename");
  }
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  ([^/\\]+)$/);
    if (!match) throw new Error(`Invalid native checksum line: ${line}`);
    const [, digest, filename] = match;
    if (!digest || !filename)
      throw new Error(`Invalid native checksum line: ${line}`);
    if (checksums.has(filename))
      throw new Error(`Duplicate native checksum entry: ${filename}`);
    checksums.set(filename, digest);
  }

  for (const artifact of manifest.artifacts) {
    const target = getNativeTarget(artifact.suffix);
    if (!target.required && !options.allowReserved) {
      throw new Error(
        `${artifact.suffix} is reserved and cannot join the initial release set`
      );
    }
    if (
      artifact.target !== target.bunTarget ||
      artifact.npmPackage !== target.npmPackage ||
      artifact.required !== target.required ||
      artifact.archive !== nativeArchiveName(manifest.version, target)
    ) {
      throw new Error(`Native manifest metadata drift for ${artifact.suffix}`);
    }
    const archive = new Uint8Array(
      await readFile(join(outputDir, artifact.archive))
    );
    if (
      archive.byteLength !== artifact.archiveSize ||
      sha256(archive) !== artifact.sha256 ||
      checksums.get(artifact.archive) !== artifact.sha256
    ) {
      throw new Error(
        `Native archive checksum or size mismatch for ${artifact.suffix}`
      );
    }
    const executable = new Uint8Array(
      await readFile(join(outputDir, "bin", artifact.suffix, target.executable))
    );
    const extracted = extractNativeArchive(target.archiveKind, archive);
    const deterministicArchive = createNativeArchive(
      target.archiveKind,
      target.executable,
      executable
    );
    if (
      extracted.name !== target.executable ||
      extracted.mode !== 0o755 ||
      extracted.bytes.byteLength !== artifact.rawSize ||
      sha256(extracted.bytes) !== sha256(executable) ||
      sha256(deterministicArchive) !== sha256(archive)
    ) {
      throw new Error(`Native archive payload mismatch for ${artifact.suffix}`);
    }
  }

  const manifestHash = sha256(manifestText);
  if (checksums.get(nativeManifestName()) !== manifestHash) {
    throw new Error("Native manifest checksum is missing or stale");
  }
  const expectedChecksumNames = [
    ...manifest.artifacts.map((artifact) => artifact.archive),
    nativeManifestName(),
  ].sort();
  if (
    JSON.stringify([...checksums.keys()].sort()) !==
    JSON.stringify(expectedChecksumNames)
  ) {
    throw new Error(
      "Native checksum inventory does not exactly cover archives and manifest"
    );
  }

  await validateSizePolicy(manifest.artifacts);
  return manifest;
}

export function selectNativeTargets(args: {
  readonly all?: boolean;
  readonly required?: boolean;
  readonly suffixes?: readonly string[];
}): readonly NativeTarget[] {
  const modes =
    Number(Boolean(args.all)) +
    Number(Boolean(args.required)) +
    Number(Boolean(args.suffixes?.length));
  if (modes !== 1) {
    throw new Error(
      "Select exactly one of --all, --required, or one or more --target values"
    );
  }
  if (args.all) return NATIVE_TARGETS;
  if (args.required) return REQUIRED_NATIVE_TARGETS;
  return (args.suffixes ?? []).map(getNativeTarget);
}

export async function nativeOutputSummary(
  outputDir = defaultOutputDir
): Promise<string> {
  const manifest = await verifyNativeArtifacts({
    allowPartial: true,
    allowReserved: true,
    outputDir,
  });
  const totalRaw = manifest.artifacts.reduce(
    (total, artifact) => total + artifact.rawSize,
    0
  );
  const totalArchive = manifest.artifacts.reduce(
    (total, artifact) => total + artifact.archiveSize,
    0
  );
  const relativeDir = relative(resolve("."), resolve(outputDir)) || outputDir;
  return `skillset: verified ${manifest.artifacts.length} native artifact(s) in ${relativeDir}; raw ${totalRaw} bytes, archived ${totalArchive} bytes`;
}
