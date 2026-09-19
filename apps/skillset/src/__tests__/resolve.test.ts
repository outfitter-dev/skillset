import { describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
  runTestGit,
} from "../../../../scripts/test-helpers/git-remote";
import { materializeConflictedPaths } from "../resolve-conflicts";

const GENERATED_ALPHA = ".agents/skills/alpha/SKILL.md";
const HAND_EDITED = ".claude/skills/alpha/SKILL.md";
const PLUGIN_SOURCE = ".skillset/plugins/demo/skills/alpha/SKILL.md";
const PLUGIN_HAND_EDITED = "plugins/demo/claude/skills/alpha/SKILL.md";
const AUTHORED_ALPHA = ".skillset/skills/alpha/SKILL.md";

describe("skillset resolve", () => {
  it("reports nothing to resolve outside a conflict", async () => {
    const root = await conflictFixture({ sameSkill: false, rebase: false });

    const result = await runCli("resolve", "--root", root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("nothing to resolve");
  });

  it("repairs and stages generated conflicts a rebase cannot merge", async () => {
    const root = await conflictFixture({ sameSkill: false, rebase: true });
    expect(await conflictedPaths(root)).toContain(
      ".agents/skills/skillset.lock"
    );

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("all conflicts cleared");
    expect(await conflictedPaths(root)).toEqual([]);
    // Both branches' source survived, and the lock was regenerated from the
    // merged tree rather than taken from either conflict side.
    const check = await runCli("check", "--only", "outputs", "--root", root);
    expect(check.exitCode).toBe(0);
  });

  it("keeps an unconfirmed resolve plan read-only", async () => {
    const root = await conflictFixture({ sameSkill: false, rebase: true });
    const lockPath = join(root, ".agents/skills/skillset.lock");
    const before = await readFile(lockPath);

    const result = await runCli("resolve", "--root", root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("rerun with --yes");
    expect(await readFile(lockPath)).toEqual(before);
    expect(await conflictedPaths(root)).toContain(
      ".agents/skills/skillset.lock"
    );
  });

  it("refuses to regenerate while authored source is still conflicted", async () => {
    const root = await conflictFixture({ sameSkill: true, rebase: true });

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(AUTHORED_ALPHA);
    expect(result.stderr).toContain(
      "authored conflicts must be resolved before generated output"
    );
    // Nothing was staged, so the generated conflicts are all still open.
    expect(await conflictedPaths(root)).toContain(GENERATED_ALPHA);
  });

  it("clears the generated conflicts once the authored one is resolved", async () => {
    const root = await conflictFixture({ sameSkill: true, rebase: true });
    await writeFile(join(root, AUTHORED_ALPHA), skill("Merged body."), "utf8");
    await runTestGit(root, "add", AUTHORED_ALPHA);

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode).toBe(0);
    expect(await conflictedPaths(root)).toEqual([]);
    const generated = await readFile(join(root, GENERATED_ALPHA), "utf8");
    expect(generated).not.toContain("<<<<<<<");
    expect(generated).toContain("Merged body.");
  });

  it("stages generated paths introduced by the merged source", async () => {
    const root = await conflictFixture({ sameSkill: true, rebase: true });
    const gammaSource = ".skillset/skills/gamma/SKILL.md";
    const gammaOutput = ".agents/skills/gamma/SKILL.md";
    await mkdir(join(root, ".skillset/skills/gamma"), { recursive: true });
    await writeFile(join(root, AUTHORED_ALPHA), skill("Merged body."), "utf8");
    await writeFile(
      join(root, gammaSource),
      "---\nname: gamma\ndescription: Gamma skill.\n---\n\nNew source.\n",
      "utf8"
    );
    await runTestGit(root, "add", AUTHORED_ALPHA, gammaSource);

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode).toBe(0);
    const staged = await runTestGit(root, "diff", "--cached", "--name-only");
    expect(staged.split("\n")).toContain(gammaOutput);
  });

  it("refuses when a generated file was hand-edited on the replayed side", async () => {
    // A rebase discards stage 3, so an edit there is exactly as lost as one on
    // stage 2 and must be caught before anything is regenerated.
    const root = await conflictFixture({
      handEditOn: "feat-b",
      rebase: true,
      sameSkill: true,
    });
    await writeFile(join(root, AUTHORED_ALPHA), skill("Merged body."), "utf8");
    await runTestGit(root, "add", AUTHORED_ALPHA);

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "edited by hand on one side of the conflict"
    );
    expect(result.stderr).toContain(HAND_EDITED);
    expect(await conflictedPaths(root)).toContain(HAND_EDITED);
  });

  it("refuses when a generated file was hand-edited on the onto side", async () => {
    const root = await conflictFixture({
      handEditOn: "feat-a",
      rebase: true,
      sameSkill: true,
    });
    await writeFile(join(root, AUTHORED_ALPHA), skill("Merged body."), "utf8");
    await runTestGit(root, "add", AUTHORED_ALPHA);

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(HAND_EDITED);
  });

  it("detects a hand edit when the lock item's sibling is not conflicted", async () => {
    // A plugin skill's lock item is [LICENSE.txt, SKILL.md] and the LICENSE
    // never changes, so only SKILL.md conflicts. Verifying the item needs the
    // unconflicted sibling too, but only the conflicted path is reported.
    const root = await pluginConflictFixture({ handEdit: true });
    await writeFile(join(root, PLUGIN_SOURCE), skill("Merged body."), "utf8");
    await runTestGit(root, "add", PLUGIN_SOURCE);

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(PLUGIN_HAND_EDITED);
    expect(result.stderr).not.toContain("LICENSE.txt");
    expect(await readFile(join(root, PLUGIN_HAND_EDITED), "utf8")).toContain(
      "Hand edit."
    );
  });

  it("reads each unconflicted lock-item sibling from its own side", async () => {
    const root = await pluginConflictFixture({
      handEdit: false,
      changeSiblingOnFeatA: true,
    });
    await writeFile(join(root, PLUGIN_SOURCE), skill("Merged body."), "utf8");
    await runTestGit(root, "add", PLUGIN_SOURCE);

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await conflictedPaths(root)).toEqual([]);
  });

  it("materializes a conflicted lock and its payload from the same side", async () => {
    const root = await largerIncomingLockFixture();
    await writeFile(join(root, AUTHORED_ALPHA), skill("Merged body."), "utf8");
    await runTestGit(root, "add", AUTHORED_ALPHA);

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await conflictedPaths(root)).toEqual([]);
  });

  it("treats output as generated when either side's lock claims it", async () => {
    // feat-a deletes the skill, so the stage 2 lock no longer claims its
    // outputs. Reading only that side would call them authored and send a
    // human to hand-merge generated files.
    const root = await deleteEditFixture();

    const planned = await runCli("resolve", "--root", root, "--json");
    const partition = JSON.parse(planned.stdout) as {
      readonly data: {
        readonly authored: readonly string[];
        readonly generated: readonly string[];
      };
    };

    expect(partition.data.authored).toEqual([AUTHORED_ALPHA]);
    expect(partition.data.generated).toContain(GENERATED_ALPHA);
  });

  it("clears a delete/edit conflict once the source question is settled", async () => {
    const root = await deleteEditFixture();
    await writeFile(join(root, AUTHORED_ALPHA), skill("Kept body."), "utf8");
    await runTestGit(root, "add", AUTHORED_ALPHA);

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode).toBe(0);
    expect(await conflictedPaths(root)).toEqual([]);
    expect(await readFile(join(root, GENERATED_ALPHA), "utf8")).toContain(
      "Kept body."
    );
  });

  it("works inside a linked worktree", async () => {
    const disposableRoot = await createTestGitFixtureRoot(
      "skillset-resolve-wt-"
    );
    const root = await conflictFixture({
      disposableRoot,
      rebase: false,
      sameSkill: false,
    });
    const worktree = await mkdtemp(join(disposableRoot, "wt-"));
    await runTestGit(root, "checkout", "--quiet", "base");
    await runTestGit(root, "worktree", "add", "--force", worktree, "feat-b");
    await rebaseOnto(worktree, "feat-a");

    const result = await runCli("resolve", "--root", worktree, "--yes");

    expect(result.exitCode).toBe(0);
    expect(await conflictedPaths(worktree)).toEqual([]);
  });

  it("resolves stage blobs from a workspace below the repository root", async () => {
    const root = await conflictFixture({
      nestedWorkspace: true,
      rebase: true,
      sameSkill: false,
    });

    const result = await runCli("resolve", "--root", root, "--yes");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await conflictedPaths(root)).toEqual([]);
  });

  it("restores the executable mode recorded by the selected conflict side", async () => {
    const disposableRoot = await createTestGitFixtureRoot(
      "skillset-resolve-mode-"
    );
    const root = await mkdtemp(join(disposableRoot, "repo-"));
    const path = "generated.sh";
    await writeFile(join(root, path), "#!/bin/sh\necho base\n");
    await chmod(join(root, path), 0o755);
    await initializeTestGitRepository(root, { disposableRoot });
    await runTestGit(root, "branch", "base");
    await runTestGit(root, "checkout", "--quiet", "-b", "feat-a");
    await writeFile(join(root, path), "#!/bin/sh\necho A\n");
    await commitAll(root, "A");
    await runTestGit(root, "checkout", "--quiet", "base");
    await runTestGit(root, "checkout", "--quiet", "-b", "feat-b");
    await writeFile(join(root, path), "#!/bin/sh\necho B\n");
    await commitAll(root, "B");
    await rebaseOnto(root, "feat-a");
    await rm(join(root, path));

    await materializeConflictedPaths(root, [path]);

    expect((await stat(join(root, path))).mode & 0o777).toBe(0o755);
  });
});

function skill(body: string): string {
  return `---\nname: alpha\ndescription: Alpha skill.\n---\n\n${body}\n`;
}

function otherSkill(body: string): string {
  return `---\nname: beta\ndescription: Beta skill.\n---\n\n${body}\n`;
}

async function conflictedPaths(root: string): Promise<readonly string[]> {
  const listed = await runTestGit(
    root,
    "diff",
    "--name-only",
    "--diff-filter=U"
  );
  return listed.split("\n").filter((line) => line.length > 0);
}

async function rebaseOnto(root: string, onto: string): Promise<void> {
  // The conflict is the point, so a non-zero exit here is expected.
  await runTestGit(root, "rebase", onto).catch(() => undefined);
}

/**
 * Two branches off a shared base. `sameSkill` decides whether the authored
 * source conflicts too, or only the generated output and locks do.
 */
async function conflictFixture(options: {
  readonly disposableRoot?: string;
  /** Append an unbuildable edit to a generated file on this branch. */
  readonly handEditOn?: "feat-a" | "feat-b";
  readonly nestedWorkspace?: boolean;
  readonly rebase: boolean;
  readonly sameSkill: boolean;
}): Promise<string> {
  const disposableRoot =
    options.disposableRoot ??
    (await createTestGitFixtureRoot("skillset-resolve-"));
  const repositoryRoot = await mkdtemp(join(disposableRoot, "repo-"));
  const root = options.nestedWorkspace
    ? join(repositoryRoot, "workspace")
    : repositoryRoot;
  await mkdir(join(root, ".skillset/skills/alpha"), { recursive: true });
  await mkdir(join(root, ".skillset/skills/beta"), { recursive: true });
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: resolve-test\n  version: 0.1.0\nclaude: true\ncodex: false\n",
    "utf8"
  );
  await writeFile(join(root, AUTHORED_ALPHA), skill("Base body."), "utf8");
  await writeFile(
    join(root, ".skillset/skills/beta/SKILL.md"),
    otherSkill("Base body."),
    "utf8"
  );
  await initializeTestGitRepository(repositoryRoot, { disposableRoot });
  await build(root);
  await commitAll(root, "base");
  await runTestGit(root, "branch", "base");

  await runTestGit(root, "checkout", "--quiet", "-b", "feat-a");
  await writeFile(join(root, AUTHORED_ALPHA), skill("Body from A."), "utf8");
  await build(root);
  if (options.handEditOn === "feat-a") await handEdit(root);
  await commitAll(root, "A");

  await runTestGit(root, "checkout", "--quiet", "base");
  await runTestGit(root, "checkout", "--quiet", "-b", "feat-b");
  if (options.sameSkill) {
    await writeFile(join(root, AUTHORED_ALPHA), skill("Body from B."), "utf8");
  } else {
    await writeFile(
      join(root, ".skillset/skills/beta/SKILL.md"),
      otherSkill("Body from B."),
      "utf8"
    );
  }
  await build(root);
  if (options.handEditOn === "feat-b") await handEdit(root);
  await commitAll(root, "B");

  if (options.rebase) await rebaseOnto(root, "feat-a");
  return root;
}

/** Edit a generated file directly, which is what this stack exists to catch. */
async function handEdit(root: string): Promise<void> {
  const path = join(root, HAND_EDITED);
  await writeFile(
    path,
    `${await readFile(path, "utf8")}\nHand edit.\n`,
    "utf8"
  );
}

/**
 * Two branches editing one plugin skill, rebased. Plugin skills produce
 * multi-file lock items, which single-file standalone skills do not.
 */
async function pluginConflictFixture(options: {
  readonly changeSiblingOnFeatA?: boolean;
  readonly handEdit: boolean;
}): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-resolve-plugin-"
  );
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/plugins/demo/skills/alpha"), {
    recursive: true,
  });
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: resolve-plugin-test\n  version: 0.1.0\nclaude: true\ncodex: false\n",
    "utf8"
  );
  await writeFile(
    join(root, ".skillset/plugins/demo/skillset.yaml"),
    "skillset:\n  name: demo\n  license: MIT\n",
    "utf8"
  );
  await writeFile(join(root, PLUGIN_SOURCE), skill("Base body."), "utf8");
  await mkdir(join(root, ".skillset/plugins/demo/skills/alpha/references"), {
    recursive: true,
  });
  await writeFile(
    join(root, ".skillset/plugins/demo/skills/alpha/references/note.md"),
    "Base reference.\n",
    "utf8"
  );
  await initializeTestGitRepository(root, { disposableRoot });
  await build(root);
  await commitAll(root, "base");
  await runTestGit(root, "branch", "base");

  await runTestGit(root, "checkout", "--quiet", "-b", "feat-a");
  if (options.changeSiblingOnFeatA === true) {
    await writeFile(
      join(root, ".skillset/plugins/demo/skills/alpha/references/note.md"),
      "Reference from A.\n",
      "utf8"
    );
  }
  await writeFile(join(root, PLUGIN_SOURCE), skill("Body from A."), "utf8");
  await build(root);
  await commitAll(root, "A");

  await runTestGit(root, "checkout", "--quiet", "base");
  await runTestGit(root, "checkout", "--quiet", "-b", "feat-b");
  await writeFile(join(root, PLUGIN_SOURCE), skill("Body from B."), "utf8");
  await build(root);
  if (options.handEdit) {
    const edited = join(root, PLUGIN_HAND_EDITED);
    await writeFile(
      edited,
      `${await readFile(edited, "utf8")}\nHand edit.\n`,
      "utf8"
    );
  }
  await commitAll(root, "B");

  await rebaseOnto(root, "feat-a");
  return root;
}

/** One lock side claims more files while both sides changed the same payload. */
async function largerIncomingLockFixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-resolve-lock-side-"
  );
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/skills/alpha"), { recursive: true });
  await mkdir(join(root, ".skillset/skills/beta"), { recursive: true });
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: resolve-lock-side\n  version: 0.1.0\nclaude: false\ncodex: true\n",
    "utf8"
  );
  await writeFile(join(root, AUTHORED_ALPHA), skill("Base body."), "utf8");
  await writeFile(
    join(root, ".skillset/skills/beta/SKILL.md"),
    otherSkill("Base body."),
    "utf8"
  );
  await initializeTestGitRepository(root, { disposableRoot });
  await build(root);
  await commitAll(root, "base");
  await runTestGit(root, "branch", "base");

  await runTestGit(root, "checkout", "--quiet", "-b", "feat-a");
  await writeFile(join(root, AUTHORED_ALPHA), skill("Body from A."), "utf8");
  await rm(join(root, ".skillset/skills/beta"), { recursive: true });
  await build(root);
  await commitAll(root, "A edits alpha and removes beta");

  await runTestGit(root, "checkout", "--quiet", "base");
  await runTestGit(root, "checkout", "--quiet", "-b", "feat-b");
  await writeFile(join(root, AUTHORED_ALPHA), skill("Body from B."), "utf8");
  await mkdir(join(root, ".skillset/skills/gamma"), { recursive: true });
  await writeFile(
    join(root, ".skillset/skills/gamma/SKILL.md"),
    "---\nname: gamma\ndescription: Gamma skill.\n---\n\nBody.\n",
    "utf8"
  );
  await build(root);
  await commitAll(root, "B edits alpha and adds gamma");

  await rebaseOnto(root, "feat-a");
  return root;
}

/** One side deletes the skill, the other edits it, then rebase. */
async function deleteEditFixture(): Promise<string> {
  const disposableRoot = await createTestGitFixtureRoot(
    "skillset-resolve-delete-"
  );
  const root = await mkdtemp(join(disposableRoot, "repo-"));
  await mkdir(join(root, ".skillset/skills/alpha"), { recursive: true });
  await mkdir(join(root, ".skillset/skills/beta"), { recursive: true });
  await writeFile(
    join(root, "skillset.yaml"),
    "skillset:\n  name: resolve-delete-test\n  version: 0.1.0\nclaude: true\ncodex: false\n",
    "utf8"
  );
  await writeFile(join(root, AUTHORED_ALPHA), skill("Base body."), "utf8");
  await writeFile(
    join(root, ".skillset/skills/beta/SKILL.md"),
    otherSkill("Base body."),
    "utf8"
  );
  await initializeTestGitRepository(root, { disposableRoot });
  await build(root);
  await commitAll(root, "base");
  await runTestGit(root, "branch", "base");

  await runTestGit(root, "checkout", "--quiet", "-b", "feat-a");
  await rm(join(root, ".skillset/skills/alpha"), { recursive: true });
  await build(root);
  await commitAll(root, "A deletes alpha");

  await runTestGit(root, "checkout", "--quiet", "base");
  await runTestGit(root, "checkout", "--quiet", "-b", "feat-b");
  await writeFile(join(root, AUTHORED_ALPHA), skill("Body from B."), "utf8");
  await build(root);
  await commitAll(root, "B edits alpha");

  await rebaseOnto(root, "feat-a");
  return root;
}

async function build(root: string): Promise<void> {
  const result = await runCli("build", "--root", root, "--yes");
  if (result.exitCode !== 0) {
    throw new Error(`resolve fixture build failed: ${result.stderr}`);
  }
}

async function commitAll(root: string, message: string): Promise<void> {
  await runTestGit(root, "add", "-A");
  await runTestGit(root, "commit", "--quiet", "-m", message);
}

async function runCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
