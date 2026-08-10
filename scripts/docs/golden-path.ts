import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createTestGitFixtureRoot } from "../test-helpers/git-remote";

const EDIT_MARKER = "Golden path second-pass edit.";
const MANAGED_OUTPUTS = [".agents", ".claude", "AGENTS.md", "skillset.lock"];

export interface GoldenPathReport {
  readonly commands: number;
  readonly generatedFiles: number;
}

export async function runDocsGoldenPath(
  repoRoot: string
): Promise<GoldenPathReport> {
  const sandbox = await createTestGitFixtureRoot("skillset-docs-golden-");
  try {
    const exampleRoot = path.join(repoRoot, "examples", "first-author");
    await cp(
      path.join(exampleRoot, "skillset.yaml"),
      path.join(sandbox, "skillset.yaml")
    );
    await cp(
      path.join(exampleRoot, ".skillset"),
      path.join(sandbox, ".skillset"),
      { recursive: true }
    );

    let commands = 0;
    await runCli(repoRoot, sandbox, ["build"]);
    commands += 1;
    assertEmpty(await managedOutputSnapshot(sandbox), "preview wrote output");

    await runCli(repoRoot, sandbox, ["build", "--yes"]);
    commands += 1;
    await runCli(repoRoot, sandbox, ["check", "--only", "outputs"]);
    commands += 1;
    const firstBuild = await managedOutputSnapshot(sandbox);
    if (firstBuild.size === 0) {
      throw new Error("skillset: docs golden path generated no output");
    }

    const sourcePath = path.join(
      sandbox,
      ".skillset",
      "skills",
      "review-notes",
      "SKILL.md"
    );
    await writeFile(
      sourcePath,
      `${await readFile(sourcePath, "utf8")}\n${EDIT_MARKER}\n`,
      "utf8"
    );
    await runCli(repoRoot, sandbox, ["check", "--only", "outputs"], 1);
    commands += 1;
    await runCli(repoRoot, sandbox, ["build"]);
    commands += 1;
    assertSnapshotsEqual(
      firstBuild,
      await managedOutputSnapshot(sandbox),
      "preview changed generated output"
    );

    await runCli(repoRoot, sandbox, ["build", "--yes"]);
    commands += 1;
    await runCli(repoRoot, sandbox, ["check", "--only", "outputs"]);
    commands += 1;
    const secondBuild = await managedOutputSnapshot(sandbox);
    for (const relativePath of [
      ".claude/skills/review-notes/SKILL.md",
      ".agents/skills/review-notes/SKILL.md",
    ]) {
      const content = secondBuild.get(relativePath);
      if (!content?.includes(EDIT_MARKER)) {
        throw new Error(
          `skillset: docs golden path edit did not reach ${relativePath}`
        );
      }
    }

    await runCli(repoRoot, sandbox, ["build", "--yes"]);
    commands += 1;
    assertSnapshotsEqual(
      secondBuild,
      await managedOutputSnapshot(sandbox),
      "a no-op rebuild changed generated output"
    );
    return { commands, generatedFiles: secondBuild.size };
  } finally {
    await rm(sandbox, { force: true, recursive: true });
  }
}

async function runCli(
  repoRoot: string,
  sandbox: string,
  args: readonly string[],
  expectedExitCode = 0
): Promise<void> {
  const child = Bun.spawn(
    [
      process.execPath,
      path.join(repoRoot, "apps", "skillset", "src", "cli.ts"),
      ...args,
      "--root",
      sandbox,
    ],
    { cwd: repoRoot, stderr: "pipe", stdout: "pipe" }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== expectedExitCode) {
    throw new Error(
      `skillset: docs golden path command failed (${args.join(" ")}; expected ${expectedExitCode}, got ${exitCode})\n${stdout}${stderr}`
    );
  }
}

async function managedOutputSnapshot(
  root: string
): Promise<ReadonlyMap<string, string>> {
  const snapshot = new Map<string, string>();
  for (const relativePath of MANAGED_OUTPUTS) {
    await collectFiles(root, relativePath, snapshot);
  }
  return snapshot;
}

async function collectFiles(
  root: string,
  relativePath: string,
  snapshot: Map<string, string>
): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  let entries;
  try {
    entries = await readdir(absolutePath, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOTDIR") {
      snapshot.set(relativePath, await readFile(absolutePath, "utf8"));
      return;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (entry.isDirectory()) {
      await collectFiles(
        root,
        path.posix.join(relativePath, entry.name),
        snapshot
      );
    } else if (entry.isFile()) {
      const childPath = path.posix.join(relativePath, entry.name);
      snapshot.set(
        childPath,
        await readFile(path.join(root, childPath), "utf8")
      );
    }
  }
}

function assertEmpty(
  snapshot: ReadonlyMap<string, string>,
  message: string
): void {
  if (snapshot.size > 0) {
    throw new Error(
      `skillset: docs golden path ${message}: ${[...snapshot.keys()].join(", ")}`
    );
  }
}

function assertSnapshotsEqual(
  expected: ReadonlyMap<string, string>,
  actual: ReadonlyMap<string, string>,
  message: string
): void {
  if (
    expected.size !== actual.size ||
    [...expected].some(([key, value]) => actual.get(key) !== value)
  ) {
    throw new Error(`skillset: docs golden path ${message}`);
  }
}
