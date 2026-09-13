/* eslint-disable func-style, no-await-in-loop, no-use-before-define -- Keep the external probe's ordered acquisition, validation, and copy evidence readable. */
/* eslint-disable no-bitwise -- File permission bits are part of the copy-fidelity hash. */
/* eslint-disable unicorn/import-style -- Node's standard named path imports keep the probe concise. */
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";

const AGENTSKILLS_REVISION = "69ef37e9424c0a7ea9dd2293b559e43ec8176379";
const AGENTSKILLS_ARCHIVE_INTEGRITY =
  "sha256:0c9eabbe602095c4f4d771ee55bf74f6bc7e1c770f25d4fe29ce9802981daa20";
const SKILLS_REF_VERSION = "0.1.0";
const SKILLS_REF_LOCK_INTEGRITY =
  "sha256:c2d1b9a8638e81f763f04928e8107741886160b6bda2b8cb9784336bebeec94a";
const SKILLS_REF_PROJECT_INTEGRITY =
  "sha256:4333dea52ff4a4fe87f96e5a25f2517a57127bbabb09cb30f3d9057da77a5967";
const SKILLS_VERSION = "1.5.26";
const SKILLS_COMMIT = "d667282815248da03a08a18272b5d2eef9caf77c";
const SKILLS_INTEGRITY =
  "sha512-D5jnWoMPDRQ3fJM3RpQH8SBrAS9tmVlTC7OdOB2tk7D6nORbRnw8RLwjVj81IIGlxwWuBthEgUChM7SOZGvTHQ==";

export interface AgentSkillsProbeCommand {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface AgentSkillsProbeCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export type AgentSkillsProbeCommandRunner = (
  command: AgentSkillsProbeCommand
) => Promise<AgentSkillsProbeCommandResult>;

export interface AgentSkillsProbeContext {
  /** Test seam; production callers must use the pinned built-in acquisition. */
  readonly acquireReference?: (
    tempRoot: string,
    environment: Readonly<Record<string, string>>,
    runner: AgentSkillsProbeCommandRunner
  ) => Promise<string>;
  readonly fetch?: typeof fetch;
  readonly repositoryRoot: string;
  readonly runner?: AgentSkillsProbeCommandRunner;
  readonly skillsRoot: string;
  readonly tempRoot: string;
}

export interface AgentSkillsProbeResult {
  readonly consumer: {
    readonly commands: readonly (readonly string[])[];
    readonly copiedSkills: readonly {
      readonly name: string;
      readonly sourceTreeHash: string;
      readonly installedTreeHash: string;
    }[];
    readonly gitHead: string;
    readonly integrity: string;
    readonly package: string;
    readonly repositoryRootDiscovery: true;
    readonly version: string;
  };
  readonly limitations: readonly string[];
  readonly profile: "agent-skills";
  readonly safety: {
    readonly repositoryUnchanged: true;
    readonly runtimeConfigurationWritten: false;
  };
  readonly validator: {
    readonly archiveIntegrity: string;
    readonly commands: readonly (readonly string[])[];
    readonly negativeCanary: string;
    readonly negativeCanaryRejected: true;
    readonly revision: string;
    readonly tool: "skills-ref validate";
    readonly validatedSkills: readonly string[];
    readonly version: string;
  };
}

interface TreeFile {
  readonly hash: string;
  readonly mode: number;
  readonly path: string;
}

/**
 * Collect maintainer-only external evidence for the Agent Skills candidate.
 * The caller owns tempRoot; every acquisition, cache, and consumer write stays
 * beneath it, while repositoryRoot is observed before and after the probe.
 */
export async function runAgentSkillsProbe(
  context: AgentSkillsProbeContext
): Promise<AgentSkillsProbeResult> {
  const repositoryRoot = await realpath(context.repositoryRoot);
  const skillsRoot = await realpath(context.skillsRoot);
  const tempRoot = await realpath(context.tempRoot);
  assertProbeRoots(repositoryRoot, skillsRoot, tempRoot);

  const commands: AgentSkillsProbeCommand[] = [];
  const delegatedRunner = context.runner ?? runCommand;
  const runner: AgentSkillsProbeCommandRunner = (command) => {
    commands.push(command);
    return delegatedRunner(command);
  };
  const environment = await isolatedEnvironment(tempRoot);
  const repositoryBefore = await treeHash(repositoryRoot);
  const skillNames = await listSkills(skillsRoot);
  if (skillNames.length === 0) {
    throw new Error("skillset: Agent Skills probe found no generated skills");
  }

  const acquiredReference = await (context.acquireReference === undefined
    ? acquireSkillsReference(
        tempRoot,
        environment,
        runner,
        context.fetch ?? fetch
      )
    : context.acquireReference(tempRoot, environment, runner));
  const referenceRoot = await realpath(acquiredReference);
  if (!contains(tempRoot, referenceRoot)) {
    throw new Error(
      "skillset: Agent Skills reference must stay beneath the probe temp root"
    );
  }
  for (const name of skillNames) {
    await expectSuccess(
      runner(
        validatorCommand(referenceRoot, join(skillsRoot, name), environment)
      ),
      `validating Agent Skill ${name}`
    );
  }

  const canary = join(tempRoot, "agent-skills-negative-canary");
  await mkdir(canary, { recursive: true });
  await writeFile(
    join(canary, "SKILL.md"),
    "---\nname: negative-canary\n---\n\n# Missing description\n"
  );
  const canaryResult = await runner(
    validatorCommand(referenceRoot, canary, environment)
  );
  if (canaryResult.exitCode === 0) {
    throw new Error(
      "skillset: skills-ref accepted the missing-description negative canary"
    );
  }

  const provenance = await readConsumerProvenance(
    repositoryRoot,
    environment,
    runner
  );
  const consumerRoot = join(tempRoot, "skills-consumer");
  await mkdir(consumerRoot, { recursive: true });
  const copiedSkills = [];
  for (const name of skillNames) {
    await expectSuccess(
      runner({
        argv: [
          "npx",
          "--yes",
          "--package",
          `skills@${SKILLS_VERSION}`,
          "skills",
          "add",
          repositoryRoot,
          "--skill",
          name,
          "--agent",
          "codex",
          "--copy",
          "--yes",
          "--json",
        ],
        cwd: consumerRoot,
        env: environment,
      }),
      `copying Agent Skill ${name} from the repository root`
    );
    const sourceTreeHash = await treeHash(join(skillsRoot, name));
    const installedTreeHash = await treeHash(
      join(consumerRoot, ".agents", "skills", name)
    );
    if (installedTreeHash !== sourceTreeHash) {
      throw new Error(
        `skillset: skills@${SKILLS_VERSION} changed copied bytes for ${name}`
      );
    }
    copiedSkills.push({ installedTreeHash, name, sourceTreeHash });
  }

  const repositoryAfter = await treeHash(repositoryRoot);
  if (repositoryAfter !== repositoryBefore) {
    throw new Error(
      "skillset: Agent Skills probe mutated the source repository"
    );
  }

  return {
    consumer: {
      commands: commands
        .filter(
          (command) => command.argv[0] === "npm" || command.argv[0] === "npx"
        )
        .map((command) => command.argv),
      copiedSkills,
      gitHead: provenance.gitHead,
      integrity: provenance.integrity,
      package: `skills@${SKILLS_VERSION}`,
      repositoryRootDiscovery: true,
      version: provenance.version,
    },
    limitations: [
      "skills-ref proves the portable Agent Skills standards floor, not provider runtime behavior.",
      "skills copy proves repository-root discovery and byte-preserving local consumption without installation into a user runtime.",
    ],
    profile: "agent-skills",
    safety: {
      repositoryUnchanged: true,
      runtimeConfigurationWritten: false,
    },
    validator: {
      archiveIntegrity: AGENTSKILLS_ARCHIVE_INTEGRITY,
      commands: commands
        .filter(
          (command) => command.argv[0] !== "npm" && command.argv[0] !== "npx"
        )
        .map((command) => command.argv),
      negativeCanary: "SKILL.md without required description frontmatter",
      negativeCanaryRejected: true,
      revision: AGENTSKILLS_REVISION,
      tool: "skills-ref validate",
      validatedSkills: skillNames,
      version: SKILLS_REF_VERSION,
    },
  };
}

function assertProbeRoots(
  repositoryRoot: string,
  skillsRoot: string,
  tempRoot: string
): void {
  const expectedSkillsRoot = join(repositoryRoot, ".agents", "skills");
  if (skillsRoot !== expectedSkillsRoot) {
    throw new Error(
      `skillset: Agent Skills probe requires ${expectedSkillsRoot}, received ${skillsRoot}`
    );
  }
  if (
    contains(repositoryRoot, tempRoot) ||
    contains(tempRoot, repositoryRoot)
  ) {
    throw new Error(
      "skillset: Agent Skills probe temp root must be disjoint from the source repository"
    );
  }
}

async function acquireSkillsReference(
  tempRoot: string,
  environment: Readonly<Record<string, string>>,
  runner: AgentSkillsProbeCommandRunner,
  fetcher: typeof fetch
): Promise<string> {
  const archive = join(tempRoot, "agentskills.tar.gz");
  const response = await fetcher(
    `https://codeload.github.com/agentskills/agentskills/tar.gz/${AGENTSKILLS_REVISION}`
  );
  if (!response.ok) {
    throw new Error(
      `skillset: failed to acquire Agent Skills reference: ${response.status}`
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  assertIntegrity(bytes, AGENTSKILLS_ARCHIVE_INTEGRITY, "Agent Skills archive");
  await writeFile(archive, bytes);
  await expectSuccess(
    runner({
      argv: ["tar", "-xzf", archive, "-C", tempRoot],
      cwd: tempRoot,
      env: environment,
    }),
    "extracting Agent Skills reference"
  );
  const referenceRoot = join(
    tempRoot,
    `agentskills-${AGENTSKILLS_REVISION}`,
    "skills-ref"
  );
  await assertFileIntegrity(
    join(referenceRoot, "uv.lock"),
    SKILLS_REF_LOCK_INTEGRITY
  );
  await assertFileIntegrity(
    join(referenceRoot, "pyproject.toml"),
    SKILLS_REF_PROJECT_INTEGRITY
  );
  await expectSuccess(
    runner({
      argv: ["uv", "sync", "--frozen", "--no-dev", "--project", referenceRoot],
      cwd: tempRoot,
      env: environment,
    }),
    "preparing pinned skills-ref"
  );
  return referenceRoot;
}

function validatorCommand(
  referenceRoot: string,
  skillRoot: string,
  environment: Readonly<Record<string, string>>
): AgentSkillsProbeCommand {
  return {
    argv: [
      "uv",
      "run",
      "--offline",
      "--frozen",
      "--no-sync",
      "--project",
      referenceRoot,
      "skills-ref",
      "validate",
      skillRoot,
    ],
    cwd: skillRoot,
    env: { ...environment, UV_OFFLINE: "1" },
  };
}

async function readConsumerProvenance(
  cwd: string,
  environment: Readonly<Record<string, string>>,
  runner: AgentSkillsProbeCommandRunner
): Promise<{
  readonly gitHead: string;
  readonly integrity: string;
  readonly version: string;
}> {
  const result = await runner({
    argv: ["npm", "view", `skills@${SKILLS_VERSION}`, "--json"],
    cwd,
    env: environment,
  });
  await expectSuccess(
    Promise.resolve(result),
    "reading pinned skills provenance"
  );
  let metadata: unknown;
  try {
    metadata = JSON.parse(result.stdout);
  } catch {
    throw new Error("skillset: pinned skills provenance was not valid JSON");
  }
  const record = asRecord(metadata);
  const dist = asRecord(record.dist);
  if (
    record.version !== SKILLS_VERSION ||
    record.gitHead !== SKILLS_COMMIT ||
    dist.integrity !== SKILLS_INTEGRITY
  ) {
    throw new Error(
      `skillset: skills@${SKILLS_VERSION} provenance did not match its pinned version, gitHead, and integrity`
    );
  }
  return {
    gitHead: SKILLS_COMMIT,
    integrity: SKILLS_INTEGRITY,
    version: SKILLS_VERSION,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function isolatedEnvironment(
  tempRoot: string
): Promise<Readonly<Record<string, string>>> {
  const environmentRoot = join(tempRoot, "environment");
  const home = join(environmentRoot, "home");
  const cache = join(environmentRoot, "cache");
  const config = join(environmentRoot, "config");
  const data = join(environmentRoot, "data");
  const state = join(environmentRoot, "state");
  await Promise.all(
    [home, cache, config, data, state].map((path) =>
      mkdir(path, { recursive: true })
    )
  );
  return {
    ...stringEnvironment(process.env),
    DO_NOT_TRACK: "1",
    HOME: home,
    UV_CACHE_DIR: join(cache, "uv"),
    UV_NO_CONFIG: "1",
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_STATE_HOME: state,
    npm_config_cache: join(cache, "npm"),
    npm_config_globalconfig: "/dev/null",
    npm_config_prefix: join(environmentRoot, "npm-prefix"),
    npm_config_userconfig: join(config, "npmrc"),
  };
}

function stringEnvironment(
  environment: NodeJS.ProcessEnv
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

async function listSkills(skillsRoot: string): Promise<readonly string[]> {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (await Bun.file(join(skillsRoot, entry.name, "SKILL.md")).exists()) {
      names.push(entry.name);
    }
  }
  return names.toSorted();
}

async function treeHash(root: string): Promise<string> {
  const files = await inventoryTree(root);
  return `sha256:${createHash("sha256").update(JSON.stringify(files)).digest("hex")}`;
}

async function inventoryTree(root: string): Promise<readonly TreeFile[]> {
  const canonicalRoot = await realpath(root);
  const files: TreeFile[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`skillset: Agent Skills probe refuses symlink ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `skillset: Agent Skills probe refuses non-file ${path}`
        );
      }
      const bytes = await readFile(path);
      const metadata = await stat(path);
      files.push({
        hash: createHash("sha256").update(bytes).digest("hex"),
        mode: metadata.mode & 0o777,
        path: relative(canonicalRoot, path).split(sep).join("/"),
      });
    }
  }
  await visit(canonicalRoot);
  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

function contains(parent: string, candidate: string): boolean {
  const offset = relative(parent, candidate);
  return offset === "" || (!offset.startsWith(`..${sep}`) && offset !== "..");
}

async function assertFileIntegrity(
  path: string,
  integrity: string
): Promise<void> {
  assertIntegrity(await readFile(path), integrity, path);
}

function assertIntegrity(
  bytes: Uint8Array,
  integrity: string,
  subject: string
): void {
  const sha512 = integrity.startsWith("sha512-");
  const algorithm = sha512 ? "sha512" : "sha256";
  const expected = integrity.slice(
    sha512 ? "sha512-".length : "sha256:".length
  );
  const actual = createHash(algorithm)
    .update(bytes)
    .digest(sha512 ? "base64" : "hex");
  if (actual !== expected) {
    throw new Error(`skillset: acquisition hash mismatch for ${subject}`);
  }
}

async function expectSuccess(
  pending: Promise<AgentSkillsProbeCommandResult>,
  action: string
): Promise<AgentSkillsProbeCommandResult> {
  const result = await pending;
  if (result.exitCode !== 0) {
    const output = result.stderr.trim() || result.stdout.trim() || "no output";
    throw new Error(
      `skillset: ${action} failed (${result.exitCode}): ${output}`
    );
  }
  return result;
}

async function runCommand(
  command: AgentSkillsProbeCommand
): Promise<AgentSkillsProbeCommandResult> {
  const child = Bun.spawn([...command.argv], {
    cwd: command.cwd,
    env: command.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}
