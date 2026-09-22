/* eslint-disable func-style, no-await-in-loop, no-use-before-define -- The maintainer workflow reads in execution order; helpers stay below the two entrypoints. */
/* eslint-disable no-bitwise, unicorn/import-style -- File modes and Node path/fs primitives are evidence inputs. */
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  buildSkillsetResult,
  gitSafeEnv,
  readCurrentGeneratedLockFromDisk,
} from "@skillset/core";
import { renderCandidateStandardProfile } from "@skillset/core/internal/candidate-standard-render";
import { getStandardProfile, listStandardProfiles } from "@skillset/registry";
import type {
  StandardProfile,
  StandardProfileId,
} from "@skillset/registry";

import {
  AGENT_INSTRUCTIONS_CODEX_PIN,
  runAgentInstructionsProbe,
} from "./agent-instructions";
import {
  AGENT_PLUGINS_CODEX_PIN,
  acquirePinnedAgentPluginsCodex,
  runAgentPluginsProbe,
} from "./agent-plugins";
import { runAgentSkillsProbe } from "./agent-skills";
import {
  createStandardsConformanceReceipt,
  hashStandardsConformanceReceipt,
  parseStandardsConformanceReceipt,
  serializeStandardsConformanceReceipt,
} from "./receipt";
import type {
  StandardsConformanceArtifact,
  StandardsConformanceCanary,
  StandardsConformanceConsumer,
  StandardsConformanceReceipt,
  StandardsConformanceValidator,
} from "./receipt";

const FIXTURE_PATH = "fixtures/standards-adoption";
const RECEIPT_ROOT = ".skillset/cache/conformance/standards";
const ROOT_SENTINEL = "SET411_ROOT_INSTRUCTIONS_SENTINEL";
const NESTED_SENTINEL = "SET411_NESTED_INSTRUCTIONS_SENTINEL";

interface TreeEntry {
  readonly bytes: number;
  readonly hash: `sha256:${string}`;
  readonly mode: string;
  readonly path: string;
}

interface TreeEvidence {
  readonly entries: readonly TreeEntry[];
  readonly hash: `sha256:${string}`;
}

export interface StandardsConformanceRunResult {
  readonly path: string;
  readonly receipt: StandardsConformanceReceipt;
  readonly receiptHash: `sha256:${string}`;
}

export interface StandardsConformanceVerificationResult {
  readonly artifactCount: number;
  readonly profile: StandardProfileId;
  readonly receiptHash: `sha256:${string}`;
  readonly rendererCommit: string;
}

/**
 * Reprove every adopted registry profile from checked-in evidence only. This
 * is the normal-check path, so it deliberately has no Git or network preconditions.
 */
export async function verifyAllAdoptedStandardsConformance(
  repositoryRoot = resolve(import.meta.dir, "../../..")
): Promise<readonly StandardsConformanceVerificationResult[]> {
  const root = await realpath(repositoryRoot);
  const results: StandardsConformanceVerificationResult[] = [];
  for (const profile of listStandardProfiles()) {
    if (profile.lifecycle !== "adopted" || profile.adoption === undefined) {
      continue;
    }
    results.push(
      await verifyAdoptedStandardsReceipt(
        profile.id,
        profile.adoption.receipt.path,
        root
      )
    );
  }
  return results;
}

/**
 * Render one profile contract through the production candidate renderer,
 * prove its bytes with pinned external consumers, and persist an ignored
 * review receipt. Adopted profiles use an in-memory candidate lifecycle view
 * so maintainers can re-record evidence after a renderer change without
 * changing the shipped registry lifecycle first.
 */
export async function runStandardsConformance(
  profileId: StandardProfileId,
  repositoryRoot = resolve(import.meta.dir, "../../..")
): Promise<StandardsConformanceRunResult> {
  const root = await realpath(repositoryRoot);
  const fixtureRoot = await realpath(join(root, FIXTURE_PATH));
  const rendererCommit = await requireCleanRenderer(root);
  const profile = getStandardProfile(profileId);
  if (profile.lifecycle === "retired") {
    throw new Error(
      `skillset: standards conformance run cannot record retired profile ${profileId}`
    );
  }
  const candidateProfiles = listStandardProfiles().map((entry) =>
    entry.id === profileId ? asCandidateProfile(entry) : entry
  );

  const before = await treeEvidence(fixtureRoot);
  const source = await treeEvidence(join(fixtureRoot, ".skillset"));
  const rendered = await renderCandidateStandardProfile(
    fixtureRoot,
    profileId,
    { profiles: candidateProfiles }
  );
  const probeRoot = await mkdtemp(
    join(tmpdir(), `skillset-standards-${profileId}-`)
  );
  try {
    const generatedRoot = join(probeRoot, "generated-repository");
    const probeState = join(probeRoot, "probe-state");
    await Promise.all([
      mkdir(generatedRoot, { recursive: true }),
      mkdir(probeState, { recursive: true }),
    ]);
    await materialize(rendered, generatedRoot);
    const artifacts = artifactEvidence(rendered);
    const probe = await runProfileProbe(
      profileId,
      generatedRoot,
      probeState,
      artifacts
    );
    const after = await treeEvidence(fixtureRoot);
    const safetyRoot = FIXTURE_PATH;
    const receipt = createStandardsConformanceReceipt({
      artifacts,
      canaries: probe.canaries,
      consumers: probe.consumers,
      lifecycle: "candidate",
      limitations: probe.limitations,
      observations: probe.observations,
      profile: profileId,
      profileSnapshot: profileSnapshotEvidence(profile),
      recordedAt: new Date().toISOString(),
      renderer: { clean: true, commit: rendererCommit },
      safety: {
        after: [{ hash: after.hash, root: safetyRoot }],
        before: [{ hash: before.hash, root: safetyRoot }],
        unchanged: true,
      },
      schemaVersion: "skillset.standards-conformance-receipt@1",
      sourceTree: {
        fileCount: source.entries.length,
        sourceHash: source.hash,
        treeHash: before.hash,
      },
      validators: probe.validators,
    });
    const receiptHash = hashStandardsConformanceReceipt(receipt);
    const receiptPath = join(root, RECEIPT_ROOT, `${profileId}.json`);
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(
      receiptPath,
      serializeStandardsConformanceReceipt(receipt),
      "utf-8"
    );
    return {
      path: relative(root, receiptPath).replaceAll("\\", "/"),
      receipt,
      receiptHash,
    };
  } finally {
    await rm(probeRoot, { force: true, recursive: true });
  }
}

function asCandidateProfile(profile: StandardProfile): StandardProfile {
  if (profile.lifecycle === "candidate") return profile;
  const { adoption: _adoption, ...contract } = profile;
  return { ...contract, lifecycle: "candidate" };
}

/**
 * Rebuild the checked fixture through the ordinary compiler's standards-only
 * mode and require exact equality with the candidate receipt's complete
 * baseline artifact set. Configured provider builds verify their deltas
 * separately.
 */
export async function verifyAdoptedStandardsConformance(
  profileId: StandardProfileId,
  receiptPath: string,
  repositoryRoot = resolve(import.meta.dir, "../../..")
): Promise<StandardsConformanceVerificationResult> {
  const root = await realpath(repositoryRoot);
  await requireCleanRenderer(root);
  const result = await verifyAdoptedStandardsReceipt(
    profileId,
    receiptPath,
    root
  );
  await requireAncestor(root, result.rendererCommit);
  return result;
}

async function verifyAdoptedStandardsReceipt(
  profileId: StandardProfileId,
  receiptPath: string,
  root: string
): Promise<StandardsConformanceVerificationResult> {
  const profile = getStandardProfile(profileId);
  if (profile.lifecycle !== "adopted" || profile.adoption === undefined) {
    throw new Error(
      `skillset: verify-adopted requires adopted registry evidence for ${profileId}`
    );
  }
  const canonicalReceiptPath = await realpath(resolve(root, receiptPath));
  const repositoryReceiptPath = relative(root, canonicalReceiptPath).replaceAll(
    "\\",
    "/"
  );
  if (repositoryReceiptPath !== profile.adoption.receipt.path) {
    throw new Error(
      `skillset: ${profileId} registry adoption evidence names ${profile.adoption.receipt.path}, not ${repositoryReceiptPath}`
    );
  }
  const receipt = parseStandardsConformanceReceipt(
    JSON.parse(await readFile(canonicalReceiptPath, "utf-8"))
  );
  if (receipt.profile !== profileId) {
    throw new Error(
      `skillset: conformance receipt is for ${receipt.profile}, not ${profileId}`
    );
  }
  const receiptHash = hashStandardsConformanceReceipt(receipt);
  if (
    profile.adoption.receipt.contentHash !== receiptHash ||
    JSON.stringify(receipt.profileSnapshot) !==
      JSON.stringify(profileSnapshotEvidence(profile)) ||
    profile.adoption.rendererCommit !== receipt.renderer.commit
  ) {
    throw new Error(
      `skillset: ${profileId} registry adoption evidence does not match the receipt`
    );
  }

  const fixtureRoot = await realpath(join(root, FIXTURE_PATH));
  const source = await treeEvidence(join(fixtureRoot, ".skillset"));
  const fixture = await treeEvidence(fixtureRoot);
  if (
    source.entries.length !== receipt.sourceTree.fileCount ||
    source.hash !== receipt.sourceTree.sourceHash ||
    fixture.hash !== receipt.sourceTree.treeHash
  ) {
    throw new Error(
      `skillset: ${profileId} adoption fixture changed after candidate validation`
    );
  }

  const temp = await mkdtemp(
    join(tmpdir(), `skillset-standards-adopted-${profileId}-`)
  );
  try {
    const builtRoot = join(temp, "repository");
    await cp(fixtureRoot, builtRoot, { recursive: true });
    const build = await buildSkillsetResult(builtRoot, { targetFilter: [] });
    if (!build.ok) {
      throw new Error(
        `skillset: adopted ${profileId} fixture build did not complete`
      );
    }
    const adoptedArtifacts = await readAdoptedArtifacts(builtRoot, profileId);
    if (
      JSON.stringify(adoptedArtifacts) !== JSON.stringify(receipt.artifacts)
    ) {
      throw new Error(
        `skillset: adopted ${profileId} bytes differ from candidate receipt`
      );
    }
    return {
      artifactCount: adoptedArtifacts.length,
      profile: profileId,
      receiptHash,
      rendererCommit: receipt.renderer.commit,
    };
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}

function profileSnapshotEvidence(
  profile: ReturnType<typeof getStandardProfile>
): StandardsConformanceReceipt["profileSnapshot"] {
  return {
    contentHash: profile.provenance.contentHash as `sha256:${string}`,
    snapshots: profile.provenance.snapshots.map((snapshot) => ({
      contentHash: snapshot.contentHash as `sha256:${string}`,
      kind: snapshot.kind,
      revision: snapshotRevision(snapshot.url),
      source: snapshot.url,
    })),
    version: profile.version,
  };
}

async function runProfileProbe(
  profileId: StandardProfileId,
  generatedRoot: string,
  probeState: string,
  artifacts: readonly StandardsConformanceArtifact[]
): Promise<{
  readonly canaries: readonly StandardsConformanceCanary[];
  readonly consumers: readonly StandardsConformanceConsumer[];
  readonly limitations: readonly string[];
  readonly observations: readonly string[];
  readonly validators: readonly StandardsConformanceValidator[];
}> {
  if (profileId === "agent-instructions") {
    const rootInstructions = await artifactText(
      generatedRoot,
      artifacts,
      "AGENTS.md"
    );
    const nestedInstructions = await artifactText(
      generatedRoot,
      artifacts,
      "nested/AGENTS.md"
    );
    const evidence = await runAgentInstructionsProbe({
      nestedInstructions,
      nestedSentinel: NESTED_SENTINEL,
      rootInstructions,
      rootSentinel: ROOT_SENTINEL,
    });
    const integrity = `sha256:${evidence.consumer.binarySha256}`;
    return {
      canaries: [
        {
          argv: evidence.invocations[1]?.argv ?? ["debug", "prompt-input"],
          id: "codex-directory-scope-exclusion",
          observed: "rejected",
          path: "nested/AGENTS.md",
        },
      ],
      consumers: [
        {
          id: "codex",
          integrity,
          pin: AGENT_INSTRUCTIONS_CODEX_PIN.binaryPath,
          version: evidence.consumer.version,
        },
      ],
      limitations: evidence.limitations,
      observations: [
        "Pinned Codex discovered the generated root AGENTS.md only at repository scope.",
        "Pinned Codex discovered the generated nested AGENTS.md only at nested scope.",
      ],
      validators: [
        {
          argv: evidence.invocations.flatMap((invocation) => invocation.argv),
          id: "codex-debug-prompt-input",
          integrity,
          outcome: "passed",
          pin: AGENT_INSTRUCTIONS_CODEX_PIN.binaryPath,
          version: evidence.consumer.version,
        },
      ],
    };
  }

  if (profileId === "agent-skills") {
    const evidence = await runAgentSkillsProbe({
      repositoryRoot: generatedRoot,
      skillsRoot: join(generatedRoot, ".agents", "skills"),
      tempRoot: probeState,
    });
    const validatorCommands = evidence.validator.commands.filter((argv) =>
      argv.includes("validate")
    );
    return {
      canaries: [
        {
          argv:
            validatorCommands.at(-1) ??
            (["skills-ref", "validate", "negative-canary"] as const),
          id: "skills-ref-missing-description",
          observed: "rejected",
          path: "canaries/agent-skills-missing-description/SKILL.md",
        },
      ],
      consumers: [
        {
          id: "skills",
          integrity: evidence.consumer.integrity,
          pin: `${evidence.consumer.package}#${evidence.consumer.gitHead}`,
          version: evidence.consumer.version,
        },
      ],
      limitations: evidence.limitations,
      observations: [
        `skills-ref validated ${evidence.validator.validatedSkills.length} generated skill(s).`,
        `skills@${evidence.consumer.version} discovered and copied every generated skill from the repository root with exact tree hashes.`,
      ],
      validators: evidence.validator.validatedSkills.map((skill, index) => ({
        argv:
          validatorCommands[index] ??
          (["skills-ref", "validate", skill] as const),
        id: `skills-ref:${skill}`,
        integrity: evidence.validator.archiveIntegrity,
        outcome: "passed" as const,
        pin: evidence.validator.revision,
        version: evidence.validator.version,
      })),
    };
  }

  const codex = await acquirePinnedAgentPluginsCodex(probeState);
  const evidence = await runAgentPluginsProbe({
    codex,
    packageRoot: join(generatedRoot, "plugins", "portable-proof"),
  });
  return {
    canaries: evidence.schemas.map(({ artifact, negativeCanary }) => ({
      argv: ["Ajv2020.compile", artifact, negativeCanary.mutation],
      id: `agent-plugins-${artifact}-unknown-field`,
      observed: "rejected" as const,
      path: `canaries/agent-plugins/${artifact}`,
    })),
    consumers: [
      {
        id: "codex",
        integrity: evidence.marketplace.codexBinaryHash,
        pin: `${AGENT_PLUGINS_CODEX_PIN.archiveUrl}#${AGENT_PLUGINS_CODEX_PIN.archiveSha256}`,
        version: evidence.marketplace.codexVersion,
      },
    ],
    limitations: [
      "Schema validation and read-only marketplace listing do not install, trust, enable, or activate the plugin.",
    ],
    observations: [
      "Ajv draft 2020-12 validated complete plugin.json and mcp.json documents against immutable registry snapshots.",
      `Pinned Codex listed ${evidence.marketplace.expectedPluginId} from an isolated local marketplace without installation.`,
    ],
    validators: evidence.schemas.map((schema) => ({
      argv: ["Ajv2020.compile", schema.schemaId, schema.artifact],
      id: `agent-plugins-schema:${schema.artifact}`,
      integrity: "ajv@8.20.0+ajv-formats@3.0.1",
      outcome: "passed" as const,
      pin: schema.schemaHash,
      version: "draft-2020-12",
    })),
  };
}

async function materialize(
  files: readonly {
    readonly content: Uint8Array;
    readonly mode: number;
    readonly path: string;
  }[],
  root: string
): Promise<void> {
  for (const file of files) {
    const destination = resolve(root, file.path);
    assertContained(root, destination);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
    await chmod(destination, file.mode);
  }
}

function artifactEvidence(
  files: readonly {
    readonly content: Uint8Array;
    readonly mode: number;
    readonly path: string;
  }[]
): readonly StandardsConformanceArtifact[] {
  return files
    .map((file) => ({
      bytes: file.content.byteLength,
      hash: hash(file.content),
      mode: fileMode(file.mode),
      path: file.path.replaceAll("\\", "/"),
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function artifactText(
  generatedRoot: string,
  artifacts: readonly StandardsConformanceArtifact[],
  path: string
): Promise<string> {
  if (!artifacts.some((artifact) => artifact.path === path)) {
    throw new Error(`skillset: candidate renderer omitted ${path}`);
  }
  return readFile(join(generatedRoot, path), "utf-8");
}

async function readAdoptedArtifacts(
  root: string,
  profileId: StandardProfileId
): Promise<readonly StandardsConformanceArtifact[]> {
  const entries: TreeEntry[] = [];
  if (profileId === "agent-instructions") {
    await visitTree(
      root,
      root,
      entries,
      (path) =>
        (path === "AGENTS.md" || path.endsWith("/AGENTS.md")) &&
        !path.startsWith(".skillset/")
    );
  } else if (profileId === "agent-skills") {
    await visitTree(
      join(root, ".agents", "skills"),
      root,
      entries,
      (path) =>
        !path.endsWith("/skillset.lock") &&
        path !== ".agents/skills/skillset.lock"
    );
  } else {
    entries.push(...(await readAdoptedAgentPluginArtifacts(root)));
  }
  return entries
    .map(({ bytes, hash: contentHash, mode, path }) => ({
      bytes,
      hash: contentHash,
      mode,
      path,
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

async function readAdoptedAgentPluginArtifacts(
  root: string
): Promise<readonly TreeEntry[]> {
  const profileId = "agent-plugins-1.0";
  const pluginsRoot = join(root, "plugins");
  const lockPath = join(pluginsRoot, "skillset.lock");
  // SET-638: evidence locks are current generated state. The Core fail-closed
  // current reader names this path and refuses missing, corrupt, or pre-v4
  // bytes instead of treating them as an empty artifact set.
  const read = await readCurrentGeneratedLockFromDisk(lockPath, {
    expectedOutputRoot: "plugins",
    logicalPath: "plugins/skillset.lock",
    missing: "error",
  });
  if (read.kind !== "present") {
    throw new Error("skillset: plugins/skillset.lock is missing");
  }
  const lock = read.lock;
  if (
    lock.selectedStandards.filter((standard) => standard === profileId)
      .length !== 1
  ) {
    throw new Error(
      "skillset: Agent Plugins evidence requires selected standard agent-plugins-1.0"
    );
  }

  const files = new Set<string>();
  for (const [index, item] of lock.items.entries()) {
    const ownerMatches =
      item.owner !== undefined &&
      "standardProfile" in item.owner &&
      item.owner.standardProfile === profileId;
    const baselineConsumers = item.consumers.filter(
      (consumer) =>
        "standardProfile" in consumer &&
        consumer.standardProfile === profileId
    );
    if (!ownerMatches && baselineConsumers.length === 0) continue;
    if (
      !ownerMatches ||
      item.role !== "standard" ||
      baselineConsumers.length !== 1
    ) {
      throw new Error(
        `skillset: plugins/skillset.lock item ${index} has inconsistent Agent Plugins ownership or role`
      );
    }
    for (const file of item.files) {
      if (file === "skillset.lock") {
        throw new Error(
          "skillset: Agent Plugins evidence cannot include plugins/skillset.lock"
        );
      }
      if (files.has(file)) {
        throw new Error(
          `skillset: Agent Plugins evidence has duplicate artifact ${file}`
        );
      }
      files.add(file);
    }
  }
  if (files.size === 0) {
    throw new Error(
      "skillset: Agent Plugins evidence lock selects no standard-owned artifacts"
    );
  }

  const entries: TreeEntry[] = [];
  for (const file of [...files].sort()) {
    const artifactPath = resolve(pluginsRoot, file);
    assertContained(pluginsRoot, artifactPath);
    const metadata = await lstat(artifactPath);
    if (!metadata.isFile()) {
      throw new Error(
        `skillset: Agent Plugins evidence artifact is not a file: plugins/${file}`
      );
    }
    const bytes = await readFile(artifactPath);
    entries.push({
      bytes: bytes.byteLength,
      hash: hash(bytes),
      mode: fileMode(metadata.mode % 0o1000),
      path: join("plugins", file).replaceAll("\\", "/"),
    });
  }
  return entries;
}

async function treeEvidence(root: string): Promise<TreeEvidence> {
  const canonical = await realpath(root);
  const entries: TreeEntry[] = [];
  await visitTree(canonical, canonical, entries, () => true);
  const digest = createHash("sha256");
  digest.update("skillset-standards-tree@1\0");
  for (const entry of entries) {
    digest.update(entry.path);
    digest.update("\0");
    digest.update(entry.mode);
    digest.update("\0");
    digest.update(String(entry.bytes));
    digest.update("\0");
    digest.update(entry.hash);
    digest.update("\0");
  }
  return { entries, hash: `sha256:${digest.digest("hex")}` };
}

async function visitTree(
  directory: string,
  root: string,
  entries: TreeEntry[],
  include: (path: string) => boolean
): Promise<void> {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  for (const entry of directoryEntries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const candidate = join(directory, entry.name);
    const metadata = await lstat(candidate);
    const path = relative(root, candidate).replaceAll("\\", "/");
    if (metadata.isSymbolicLink()) {
      throw new Error(`skillset: standards evidence rejects symlink ${path}`);
    }
    if (metadata.isDirectory()) {
      await visitTree(candidate, root, entries, include);
      continue;
    }
    if (!metadata.isFile() || !include(path)) {
      continue;
    }
    const bytes = await readFile(candidate);
    entries.push({
      bytes: bytes.byteLength,
      hash: hash(bytes),
      mode: fileMode(metadata.mode % 0o1000),
      path,
    });
  }
}

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fileMode(mode: number): string {
  return (0o10_0000 | mode).toString(8).padStart(6, "0");
}

function snapshotRevision(url: string): string {
  const match = /\/(?<revision>[a-f0-9]{40})\//u.exec(new URL(url).pathname);
  if (match?.groups?.revision === undefined) {
    throw new Error(
      `skillset: standard snapshot URL lacks immutable revision: ${url}`
    );
  }
  return match.groups.revision;
}

async function requireCleanRenderer(root: string): Promise<string> {
  const [head, unstaged, staged] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["diff", "--quiet"]),
    git(root, ["diff", "--cached", "--quiet"]),
  ]);
  if (unstaged.exitCode !== 0 || staged.exitCode !== 0) {
    throw new Error(
      "skillset: standards conformance requires a clean tracked renderer commit"
    );
  }
  const commit = head.stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("skillset: could not resolve standards renderer commit");
  }
  return commit;
}

async function requireAncestor(root: string, commit: string): Promise<void> {
  const result = await git(root, [
    "merge-base",
    "--is-ancestor",
    commit,
    "HEAD",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `skillset: receipt renderer ${commit} is not an ancestor of the adopted head`
    );
  }
}

async function git(
  cwd: string,
  argv: readonly string[]
): Promise<{ readonly exitCode: number; readonly stdout: string }> {
  const process = Bun.spawn(["git", ...argv], {
    cwd,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  return { exitCode, stdout };
}

function assertContained(root: string, candidate: string): void {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(candidate) === resolve(root)
  ) {
    throw new Error(
      `skillset: refusing standards evidence path outside disposable root: ${candidate}`
    );
  }
}
