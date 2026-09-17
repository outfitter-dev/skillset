/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- Named declarations keep this maintainer probe's exported entrypoints and private stages readable in execution order. */
import { createHash } from "node:crypto";
import {
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
import path from "node:path";

import { listStandardProfileSchemaSnapshots } from "@skillset/registry";
import addFormats from "ajv-formats";
import ajvFormatsPackage from "ajv-formats/package.json";
import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv/dist/2020";
import ajvPackage from "ajv/package.json";

const PROFILE_ID = "agent-plugins-1.0" as const;
const REQUIRED_CODEX_LINE = "0.154.0";
const PLUGIN_SCHEMA_ID =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

type JsonObject = Readonly<Record<string, unknown>>;

export interface AgentPluginsProbeInput {
  /** Released Codex executable pinned by exact version and binary bytes. */
  readonly codex: CodexConsumerPin;
  /** Exact generated `plugins/<plugin>` package root. */
  readonly packageRoot: string;
}

export interface CodexConsumerPin {
  readonly binaryPath: string;
  readonly sha256: `sha256:${string}`;
  readonly version: string;
}

export const AGENT_PLUGINS_CODEX_PIN: CodexConsumerPin = {
  binaryPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
  sha256:
    "sha256:a1d2f191e70023ed7afd619bc70530f26067a085926e03bae50cf5c0f8298bcf",
  version: "0.154.0-alpha.6.2",
};

export interface AgentPluginsSchemaEvidence {
  readonly artifact: "mcp.json" | "plugin.json";
  readonly artifactHash: string;
  readonly negativeCanary: {
    readonly diagnostic: string;
    readonly mutation: "unknown-top-level-field";
    readonly rejected: true;
  };
  readonly schemaHash: string;
  readonly schemaId: string;
  readonly valid: true;
  readonly validator: {
    readonly ajv: "8.20.0";
    readonly ajvFormats: "3.0.1";
    readonly draft: "2020-12";
  };
}

export interface AgentPluginsMarketplaceEvidence {
  readonly availablePluginIds: readonly string[];
  readonly catalogHash: string;
  readonly catalogName: string;
  readonly codexBinaryHash: string;
  readonly codexVersion: string;
  readonly command: readonly string[];
  readonly expectedPluginId: string;
  readonly isolatedState: true;
  readonly packageCopyHash: string;
  readonly pin: CodexConsumerPin;
  readonly readOnly: true;
}

export interface AgentPluginsPackageEvidence {
  readonly files: readonly {
    readonly hash: string;
    readonly mode: number;
    readonly path: string;
  }[];
  readonly root: string;
  readonly treeHash: string;
}

export interface AgentPluginsProbeEvidence {
  readonly marketplace: AgentPluginsMarketplaceEvidence;
  readonly package: AgentPluginsPackageEvidence;
  readonly profile: typeof PROFILE_ID;
  readonly schemas: readonly AgentPluginsSchemaEvidence[];
}

/**
 * Validate a candidate Agent Plugins package without installing, enabling,
 * trusting, or persisting it in a real Codex runtime.
 */
export async function runAgentPluginsProbe(
  input: AgentPluginsProbeInput
): Promise<AgentPluginsProbeEvidence> {
  assertPinnedValidatorVersions();
  const packageEvidence = await inventoryPackage(input.packageRoot);
  const schemas = await validateAgentPluginsSchemas(packageEvidence.root);
  const marketplace = await validateCodexMarketplace(
    packageEvidence,
    input.codex
  );
  return {
    marketplace,
    package: packageEvidence,
    profile: PROFILE_ID,
    schemas,
  };
}

/** Validate complete plugin.json and mcp.json documents against pinned bodies. */
export async function validateAgentPluginsSchemas(
  packageRoot: string
): Promise<readonly AgentPluginsSchemaEvidence[]> {
  assertPinnedValidatorVersions();
  const canonicalRoot = await realpath(packageRoot);
  const snapshots = listStandardProfileSchemaSnapshots(PROFILE_ID);
  return Promise.all(
    [
      { artifact: "plugin.json" as const, schemaId: PLUGIN_SCHEMA_ID },
      { artifact: "mcp.json" as const, schemaId: MCP_SCHEMA_ID },
    ].map(async ({ artifact, schemaId }) => {
      const snapshot = snapshots.find(({ body }) => {
        const value = parseJsonObject(body, `pinned ${artifact} schema`);
        return value.$id === schemaId;
      });
      if (snapshot === undefined) {
        throw new Error(
          `skillset: missing pinned Agent Plugins schema ${schemaId}`
        );
      }
      const artifactPath = path.join(canonicalRoot, artifact);
      const source = await readFile(artifactPath, "utf-8");
      const value = parseJsonObject(source, artifact);
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      addFormats(ajv);
      const validate = ajv.compile(JSON.parse(snapshot.body));
      if (!validate(value)) {
        throw new Error(
          `skillset: ${artifact} failed pinned Agent Plugins schema validation: ${formatErrors(validate.errors)}`
        );
      }
      const canary = { ...value, skillsetInvalidCanary: true };
      if (validate(canary)) {
        throw new Error(
          `skillset: ${artifact} negative canary unexpectedly passed pinned schema validation`
        );
      }
      return {
        artifact,
        artifactHash: hashBytes(source),
        negativeCanary: {
          diagnostic: formatErrors(validate.errors),
          mutation: "unknown-top-level-field",
          rejected: true,
        },
        schemaHash: snapshot.contentHash,
        schemaId,
        valid: true,
        validator: {
          ajv: "8.20.0",
          ajvFormats: "3.0.1",
          draft: "2020-12",
        },
      } satisfies AgentPluginsSchemaEvidence;
    })
  );
}

async function validateCodexMarketplace(
  packageEvidence: AgentPluginsPackageEvidence,
  pin: CodexConsumerPin
): Promise<AgentPluginsMarketplaceEvidence> {
  const manifest = parseJsonObject(
    await readFile(path.join(packageEvidence.root, "plugin.json"), "utf-8"),
    "plugin.json"
  );
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error("skillset: Agent Plugins probe requires plugin.json name");
  }
  const isolatedRoot = await mkdtemp(
    path.join(tmpdir(), "skillset-agent-plugins-conformance-")
  );
  try {
    const marketplaceRoot = path.join(isolatedRoot, "marketplace");
    const stagedPackage = path.join(
      marketplaceRoot,
      "plugins",
      manifest.name
    );
    await mkdir(path.join(marketplaceRoot, ".agents", "plugins"), {
      recursive: true,
    });
    await cp(packageEvidence.root, stagedPackage, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
    });
    const copiedPackage = await inventoryPackage(stagedPackage);
    if (copiedPackage.treeHash !== packageEvidence.treeHash) {
      throw new Error(
        "skillset: staged Agent Plugins package differs from rendered package"
      );
    }
    const catalogName = "skillset-agent-plugins-conformance";
    const catalog = `${JSON.stringify(
      {
        interface: { displayName: "Skillset Agent Plugins conformance" },
        name: catalogName,
        plugins: [
          {
            name: manifest.name,
            policy: {
              authentication: "ON_INSTALL",
              installation: "AVAILABLE",
            },
            source: {
              path: `./plugins/${manifest.name}`,
              source: "local",
            },
          },
        ],
      },
      null,
      2
    )}\n`;
    const catalogPath = path.join(
      marketplaceRoot,
      ".agents",
      "plugins",
      "marketplace.json"
    );
    await writeFile(catalogPath, catalog);

    const environment = await isolatedEnvironment(isolatedRoot);
    const codexBinaryHash = await assertCodexIntegrity(pin);
    const version = await runCodex(
      pin.binaryPath,
      ["--version"],
      marketplaceRoot,
      environment
    );
    const codexVersion = version.stdout.trim();
    if (!/^0\.154\.0(?:$|-)/u.test(pin.version)) {
      throw new Error(
        `skillset: Agent Plugins marketplace probe pin must target Codex ${REQUIRED_CODEX_LINE}, received ${pin.version}`
      );
    }
    if (codexVersion !== `codex-cli ${pin.version}`) {
      throw new Error(
        `skillset: Agent Plugins marketplace probe requires Codex ${pin.version}, received ${codexVersion || "empty version output"}`
      );
    }
    const command = [
      "--enable",
      "plugins",
      "-c",
      'marketplaces.skillset_conformance.source_type="local"',
      "-c",
      `marketplaces.skillset_conformance.source=${JSON.stringify(marketplaceRoot)}`,
      "plugin",
      "list",
      "--available",
      "--json",
    ] as const;
    await assertCodexIntegrity(pin);
    const listing = await runCodex(
      pin.binaryPath,
      command,
      marketplaceRoot,
      environment
    );
    const availablePluginIds = parseAvailablePluginIds(listing.stdout);
    const expectedPluginId = `${manifest.name}@${catalogName}`;
    if (!availablePluginIds.includes(expectedPluginId)) {
      throw new Error(
        `skillset: Codex ${pin.version} omitted Agent Plugins package ${expectedPluginId}`
      );
    }
    return {
      availablePluginIds,
      catalogHash: hashBytes(catalog),
      catalogName,
      codexBinaryHash,
      codexVersion,
      command: [pin.binaryPath, ...command],
      expectedPluginId,
      isolatedState: true,
      packageCopyHash: copiedPackage.treeHash,
      pin,
      readOnly: true,
    };
  } finally {
    await rm(isolatedRoot, { force: true, recursive: true });
  }
}

async function assertCodexIntegrity(pin: CodexConsumerPin): Promise<string> {
  if (!/^sha256:[a-f0-9]{64}$/u.test(pin.sha256)) {
    throw new Error(
      "skillset: Agent Plugins Codex pin must contain an exact SHA-256"
    );
  }
  const actual = hashBytes(await readFile(pin.binaryPath));
  if (actual !== pin.sha256) {
    throw new Error(
      `skillset: Agent Plugins Codex binary integrity mismatch: expected ${pin.sha256}, received ${actual}`
    );
  }
  return actual;
}

async function inventoryPackage(
  packageRoot: string
): Promise<AgentPluginsPackageEvidence> {
  const initial = await lstat(packageRoot);
  if (!initial.isDirectory() || initial.isSymbolicLink()) {
    throw new Error(
      "skillset: Agent Plugins package root must be a real directory"
    );
  }
  const canonicalRoot = await realpath(packageRoot);
  const files: { hash: string; mode: number; path: string }[] = [];
  await visit(canonicalRoot, canonicalRoot, files);
  const required = new Set(["plugin.json", "mcp.json"]);
  for (const file of files) {
    required.delete(file.path);
  }
  if (required.size > 0) {
    throw new Error(
      `skillset: Agent Plugins probe package is missing ${[...required].join(", ")}`
    );
  }
  const hash = createHash("sha256");
  hash.update("skillset-agent-plugins-package-v1\0");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(file.mode));
    hash.update("\0");
    hash.update(file.hash);
    hash.update("\0");
  }
  return {
    files,
    root: canonicalRoot,
    treeHash: `sha256:${hash.digest("hex")}`,
  };
}

async function visit(
  root: string,
  directory: string,
  files: { hash: string; mode: number; path: string }[]
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  // Sequential traversal keeps receipt order stable and bounds open files.
  // oxlint-disable-next-line eslint/no-await-in-loop
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const entryPath = path.join(directory, entry.name);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `skillset: Agent Plugins probe rejects symlink ${path.relative(root, entryPath)}`
      );
    }
    if (stats.isDirectory()) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await visit(root, entryPath, files);
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop
    const content = await readFile(entryPath);
    files.push({
      hash: hashBytes(content),
      mode: stats.mode % 0o1000,
      path: path.relative(root, entryPath).replaceAll("\\", "/"),
    });
  }
}

async function isolatedEnvironment(
  isolatedRoot: string
): Promise<Record<string, string>> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
  const roots = {
    CODEX_HOME: path.join(isolatedRoot, "codex-home"),
    HOME: path.join(isolatedRoot, "home"),
    XDG_CACHE_HOME: path.join(isolatedRoot, "xdg", "cache"),
    XDG_CONFIG_HOME: path.join(isolatedRoot, "xdg", "config"),
    XDG_DATA_HOME: path.join(isolatedRoot, "xdg", "data"),
    XDG_STATE_HOME: path.join(isolatedRoot, "xdg", "state"),
  };
  await Promise.all(
    Object.values(roots).map((root) => mkdir(root, { recursive: true }))
  );
  return { ...environment, ...roots };
}

async function runCodex(
  codexBin: string,
  argv: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>
): Promise<{ readonly stdout: string }> {
  const process = Bun.spawn([codexBin, ...argv], {
    cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `skillset: Codex Agent Plugins marketplace probe failed (${exitCode}): ${stderr.trim() || stdout.trim()}`
    );
  }
  return { stdout };
}

function parseAvailablePluginIds(stdout: string): readonly string[] {
  const value = parseJsonObject(stdout, "Codex marketplace listing");
  if (!Array.isArray(value.available)) {
    throw new TypeError(
      "skillset: Codex marketplace listing omitted available plugins"
    );
  }
  return value.available.map((entry) => {
    if (!isJsonObject(entry) || typeof entry.pluginId !== "string") {
      throw new TypeError(
        "skillset: Codex marketplace listing has invalid plugin entry"
      );
    }
    return entry.pluginId;
  });
}

function parseJsonObject(source: string, subject: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`skillset: ${subject} is not valid JSON`, { cause: error });
  }
  if (!isJsonObject(value)) {
    throw new TypeError(`skillset: ${subject} must be a JSON object`);
  }
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatErrors(
  errors: readonly ErrorObject[] | null | undefined
): string {
  if (errors === undefined || errors === null || errors.length === 0) {
    return "validator returned no diagnostic";
  }
  return errors
    .map(
      ({ instancePath, message }) =>
        `${instancePath || "/"} ${message ?? "is invalid"}`
    )
    .join("; ");
}

function hashBytes(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertPinnedValidatorVersions(): void {
  if (
    ajvPackage.version !== "8.20.0" ||
    ajvFormatsPackage.version !== "3.0.1"
  ) {
    throw new Error(
      `skillset: Agent Plugins probe requires ajv@8.20.0 and ajv-formats@3.0.1, received ajv@${ajvPackage.version} and ajv-formats@${ajvFormatsPackage.version}`
    );
  }
}
