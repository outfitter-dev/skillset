/* eslint-disable func-style, no-use-before-define -- Keep the fixture's setup and assertions in execution order. */
/* eslint-disable unicorn/import-style -- Node's standard named imports keep the fixture concise. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildSkillsetResult } from "@skillset/core";

const SKILLS_VERSION = "1.5.26";
const SKILLS_COMMIT = "d667282815248da03a08a18272b5d2eef9caf77c";
const PACKAGE = `skills@${SKILLS_VERSION}`;

interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const root = await mkdtemp(
  join(tmpdir(), "skillset-external-skills-consumer-")
);

try {
  const npmCache = join(root, "npm-cache");
  const environment = {
    ...process.env,
    DO_NOT_TRACK: "1",
    npm_config_cache: npmCache,
  };
  await mkdir(npmCache, { recursive: true });

  await assertPinnedConsumer(environment);
  await Promise.all(
    (["implicit", "declared"] as const).flatMap((catalog) =>
      (["plugins", "dist"] as const).map((outputRoot) =>
        assertConsumerInstall(root, environment, catalog, outputRoot)
      )
    )
  );
} finally {
  if (process.env.SKILLSET_RETAIN_EXTERNAL_CONFORMANCE === "1") {
    console.error(`skillset: retained Skills consumer fixture ${root}`);
  } else {
    await rm(root, { force: true, recursive: true });
  }
}

async function assertPinnedConsumer(
  environment: Record<string, string | undefined>
): Promise<void> {
  const result = await run(
    ["npm", "view", PACKAGE, "gitHead"],
    root,
    environment
  );
  assertSuccess(result, `reading ${PACKAGE} provenance`);
  if (result.stdout.trim() !== SKILLS_COMMIT) {
    throw new Error(
      `skillset: ${PACKAGE} resolved ${JSON.stringify(result.stdout.trim())}, expected ${SKILLS_COMMIT}`
    );
  }
}

async function assertConsumerInstall(
  parent: string,
  environment: Record<string, string | undefined>,
  catalog: "declared" | "implicit",
  outputRoot: "dist" | "plugins"
): Promise<void> {
  const fixtureRoot = join(parent, `${catalog}-${outputRoot}`);
  const consumer = join(fixtureRoot, "consumer");
  const consumerSource =
    outputRoot === "plugins" ? fixtureRoot : join(fixtureRoot, "dist");
  await writeFixture(fixtureRoot, catalog, outputRoot);
  await mkdir(consumer, { recursive: true });

  const build = await buildSkillsetResult(fixtureRoot);
  if (!build.ok) {
    throw new Error(
      `skillset: failed to build ${catalog}/${outputRoot} consumer fixture`
    );
  }

  const marketplacePath =
    outputRoot === "plugins"
      ? join(fixtureRoot, ".claude-plugin", "marketplace.json")
      : join(fixtureRoot, "dist", ".claude-plugin", "marketplace.json");
  const marketplace = JSON.parse(await readFile(marketplacePath, "utf-8")) as {
    readonly metadata: Record<string, unknown>;
    readonly plugins: readonly {
      readonly name: string;
      readonly source: string;
    }[];
  };
  const expectedSource =
    outputRoot === "plugins"
      ? "./plugins/consumer-plugin/claude"
      : "./plugins/consumer-plugin";
  if (marketplace.metadata.pluginRoot !== undefined) {
    throw new Error(
      `skillset: ${catalog}/${outputRoot} emitted redundant Claude metadata.pluginRoot`
    );
  }
  if (
    !marketplace.plugins.some(
      (plugin) =>
        plugin.name === "consumer-plugin" && plugin.source === expectedSource
    )
  ) {
    throw new Error(
      `skillset: ${catalog}/${outputRoot} changed Claude source semantics`
    );
  }

  const providerRoots = {
    claude:
      outputRoot === "plugins"
        ? join(fixtureRoot, "plugins", "consumer-plugin", "claude")
        : join(fixtureRoot, "dist", "plugins", "consumer-plugin"),
    codex: join(
      fixtureRoot,
      "generated",
      "codex",
      "plugins",
      "consumer-plugin"
    ),
    cursor: join(
      fixtureRoot,
      "generated",
      "cursor",
      "plugins",
      "consumer-plugin"
    ),
  } as const;
  await Promise.all(
    (["claude", "codex", "cursor"] as const).map(async (target) => {
      const sentinel = await readFile(
        join(
          providerRoots[target],
          "skills",
          "canonical-skill",
          `${target}-sentinel.txt`
        ),
        "utf-8"
      );
      if (sentinel.trim() !== `${target.toUpperCase()}-SENTINEL`) {
        throw new Error(`skillset: missing ${target} provider sentinel`);
      }
    })
  );

  // Mutate source after generation. The consumer must follow the marketplace
  // entry to the generated bundle, never fall back to this raw source.
  await Promise.all([
    writeText(
      join(
        fixtureRoot,
        ".skillset",
        "plugins",
        "consumer-plugin",
        "skills",
        "canonical-skill",
        "SKILL.md"
      ),
      "---\nname: canonical-skill\ndescription: Raw fallback sentinel.\n---\n\nRAW-SKILL-BODY\n"
    ),
    writeText(
      join(
        fixtureRoot,
        ".skillset",
        "plugins",
        "consumer-plugin",
        "shared",
        "references",
        "declared-resource.md"
      ),
      "RAW-RESOURCE-BYTES\n"
    ),
    writeText(
      join(
        fixtureRoot,
        ".skillset",
        "plugins",
        "consumer-plugin",
        "skills",
        "canonical-skill",
        "LICENSE.txt"
      ),
      "RAW-LICENSE-BYTES\n"
    ),
    writeText(
      join(consumerSource, "deep", "full-depth", "SKILL.md"),
      "---\nname: deep-only\ndescription: Full-depth consumer proof.\n---\n\nFULL-DEPTH-SENTINEL\n"
    ),
  ]);

  await install(consumerSource, consumer, environment, [
    "--skill",
    "canonical-skill",
  ]);
  const installed = join(consumer, ".agents", "skills", "canonical-skill");
  await assertContains(join(installed, "SKILL.md"), "CANONICAL-SKILL-BODY");
  await assertContains(
    join(installed, "SKILL.md"),
    "GENERATED-NAME=canonical-skill"
  );
  await assertContains(
    join(installed, "SKILL.md"),
    "GENERATED-SOURCE=.skillset/plugins/consumer-plugin/skills/canonical-skill/SKILL.md"
  );
  await assertNotContains(join(installed, "SKILL.md"), "RAW-SKILL-BODY");
  await assertNotContains(join(installed, "SKILL.md"), "{{this.name}}");
  await assertNotContains(
    join(installed, "SKILL.md"),
    "{{skillset.source_path}}"
  );
  await assertNotContains(join(installed, "SKILL.md"), "preprocess: true");
  await assertNotContains(join(installed, "SKILL.md"), "resources:");
  await assertFileEquals(
    join(installed, "claude-sentinel.txt"),
    "CLAUDE-SENTINEL\n"
  );
  await assertFileEquals(
    join(installed, "references", "declared-resource.md"),
    "GENERATED-RESOURCE-BYTES\n"
  );
  await assertFileEquals(
    join(installed, "LICENSE.txt"),
    "GENERATED-LICENSE-BYTES\n"
  );

  const withoutFullDepth = await runSkills(
    consumerSource,
    consumer,
    environment,
    ["--skill", "deep-only", "--json"]
  );
  if (withoutFullDepth.exitCode === 0) {
    throw new Error(
      "skillset: Skills consumer crossed the default discovery boundary"
    );
  }
  await install(consumerSource, consumer, environment, [
    "--skill",
    "deep-only",
    "--full-depth",
  ]);
  await assertContains(
    join(consumer, ".agents", "skills", "deep-only", "SKILL.md"),
    "FULL-DEPTH-SENTINEL"
  );
}

async function writeFixture(
  fixtureRoot: string,
  catalog: "declared" | "implicit",
  outputRoot: "dist" | "plugins"
): Promise<void> {
  const declaredCatalog =
    catalog === "declared"
      ? `marketplaces:
  consumer:
    targets: [claude]
    plugins:
      - plugin: consumer-plugin
`
      : "";
  const pluginPath = join(
    fixtureRoot,
    ".skillset",
    "plugins",
    "consumer-plugin"
  );
  await Promise.all([
    writeText(
      join(fixtureRoot, "skillset.yaml"),
      `skillset:
  name: consumer-marketplace
claude:
  plugins:
    path: ${outputRoot}
codex:
  plugins:
    path: generated/codex
cursor:
  plugins:
    path: generated/cursor
${declaredCatalog}`
    ),
    writeText(
      join(pluginPath, "skillset.yaml"),
      "skillset:\n  name: consumer-plugin\n  license: none\n"
    ),
    writeText(
      join(pluginPath, "skills", "canonical-skill", "SKILL.md"),
      "---\nname: canonical-skill\ndescription: Canonical consumer proof.\nresources:\n  references:\n    - plugin:references/declared-resource.md\nskillset:\n  preprocess: true\n---\n\nCANONICAL-SKILL-BODY\nGENERATED-NAME={{this.name}}\nGENERATED-SOURCE={{skillset.source_path}}\n"
    ),
    writeText(
      join(pluginPath, "shared", "references", "declared-resource.md"),
      "GENERATED-RESOURCE-BYTES\n"
    ),
    writeText(
      join(pluginPath, "skills", "canonical-skill", "LICENSE.txt"),
      "GENERATED-LICENSE-BYTES\n"
    ),
    ...(["claude", "codex", "cursor"] as const).map((target) =>
      writeText(
        join(
          pluginPath,
          `_${target}`,
          "skills",
          "canonical-skill",
          `${target}-sentinel.txt`
        ),
        `${target.toUpperCase()}-SENTINEL\n`
      )
    ),
  ]);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function install(
  source: string,
  consumer: string,
  environment: Record<string, string | undefined>,
  args: readonly string[]
): Promise<void> {
  const result = await runSkills(source, consumer, environment, [
    ...args,
    "--agent",
    "codex",
    "--copy",
    "--yes",
    "--json",
  ]);
  assertSuccess(result, `installing ${args.join(" ")} from ${source}`);
}

function runSkills(
  source: string,
  cwd: string,
  environment: Record<string, string | undefined>,
  args: readonly string[]
): Promise<CommandResult> {
  return run(
    ["npx", "--yes", "--package", PACKAGE, "skills", "add", source, ...args],
    cwd,
    environment
  );
}

async function assertContains(path: string, expected: string): Promise<void> {
  const content = await readFile(path, "utf-8");
  if (!content.includes(expected)) {
    throw new Error(`skillset: expected ${path} to include ${expected}`);
  }
}

async function assertNotContains(
  path: string,
  unexpected: string
): Promise<void> {
  const content = await readFile(path, "utf-8");
  if (content.includes(unexpected)) {
    throw new Error(`skillset: expected ${path} not to include ${unexpected}`);
  }
}

async function assertFileEquals(path: string, expected: string): Promise<void> {
  const content = await readFile(path, "utf-8");
  if (content !== expected) {
    throw new Error(`skillset: expected ${path} to equal ${expected}`);
  }
}

async function run(
  command: readonly string[],
  cwd: string,
  environment: Record<string, string | undefined>
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    cwd,
    env: environment,
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

function assertSuccess(result: CommandResult, action: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `skillset: ${action} failed (${result.exitCode}):\n${result.stdout}${result.stderr}`
    );
  }
}
