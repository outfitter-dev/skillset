import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { gitSafeEnv } from "../git-env";
import {
  formatInteractiveInitPlan,
  interactiveRepositoryDisplay,
  interactiveTargetDefaults,
  promptForInteractiveCandidates,
  runInteractiveInit,
  selectedInteractiveCandidates,
} from "../init-interactive";
import { createInteractiveSession } from "../interactive-session";
import { ScriptedPromptAdapter } from "../prompt-adapter";

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const ttyOutput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });

function scriptedSession(
  answers: ConstructorParameters<typeof ScriptedPromptAdapter>[0]
) {
  const adapter = new ScriptedPromptAdapter(answers);
  const output = ttyOutput();
  let transcript = "";
  output.on("data", (chunk: Buffer) => {
    transcript += chunk.toString();
  });
  const session = createInteractiveSession({
    adapter,
    env: { CI: "false" },
    input: ttyInput(),
    output,
  });
  if (session === undefined) throw new Error("expected interactive session");
  return { adapter, readTranscript: () => transcript, session };
}

describe("SET-312 existing-directory init", () => {
  test("describes detected entries concretely and imports everything", async () => {
    const candidates = [
      { kind: "instructions" as const, path: "AGENTS.md" },
      { kind: "skills" as const, path: ".agents/skills" },
    ];
    const { adapter, readTranscript, session } = scriptedSession([
      { kind: "select", value: "all" },
    ]);

    await expect(
      promptForInteractiveCandidates(candidates, session)
    ).resolves.toEqual(["instructions:AGENTS.md", "skills:.agents/skills"]);
    adapter.assertComplete();
    expect(adapter.prompts[0]).toEqual({
      kind: "select",
      prompt: expect.objectContaining({
        default: "all",
        message: "How should Skillset start?",
      }),
    });
    expect(readTranscript()).toContain("Found in this repository");
    expect(readTranscript()).toContain("1 skill collection");
    expect(readTranscript()).toContain("1 instruction file");
    expect(readTranscript()).not.toContain("material");
  });

  test("custom import uses adapter-owned grouped selection", async () => {
    const candidates = [
      {
        kind: "plugin" as const,
        path: "plugins/outfitter/claude",
        plugin: {
          identity: "outfitter",
          paths: ["plugins/outfitter/claude", "plugins/outfitter/codex"],
          providers: ["claude" as const, "codex" as const],
          relation: "equivalent" as const,
        },
      },
      { kind: "skills" as const, path: ".agents/skills" },
      { kind: "instructions" as const, path: "CLAUDE.md" },
    ];
    const selected = [
      "plugin:plugins/outfitter/claude",
      "instructions:CLAUDE.md",
    ];
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "choose" },
      { kind: "group-checkbox", value: selected },
    ]);

    await expect(
      promptForInteractiveCandidates(candidates, session)
    ).resolves.toEqual(selected);
    adapter.assertComplete();
    const prompt = adapter.prompts[1];
    if (prompt?.kind !== "group-checkbox") {
      throw new Error("expected grouped candidate prompt");
    }
    expect(prompt.prompt.message).toBe("Choose what to import:");
    expect(prompt.prompt.required).toBe(true);
    expect(prompt.prompt.groups.map((group) => group.name)).toEqual([
      "Plugins",
      "Skills",
      "Instruction files",
    ]);
    expect(prompt.prompt.groups[0]?.choices[0]).toEqual(
      expect.objectContaining({ name: "outfitter (Claude, Codex)" })
    );
  });

  test("start empty leaves detected entries unselected", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "none" },
    ]);
    await expect(
      promptForInteractiveCandidates(
        [{ kind: "instructions", path: "AGENTS.md" }],
        session
      )
    ).resolves.toEqual([]);
    adapter.assertComplete();
    const prompt = adapter.prompts[0];
    if (prompt?.kind !== "select") throw new Error("expected intent prompt");
    expect(prompt.prompt.choices).toContainEqual(
      expect.objectContaining({ name: "Start empty", value: "none" })
    );
  });

  test("repository display derives GitHub identity and falls back to cwd", async () => {
    const repository = await mkdtemp(join(tmpdir(), "skillset-init-label-git-"));
    await runGit(repository, "init", "-q");
    await runGit(repository, "remote", "add", "origin", "git@github.com:Outfitter-Dev/Skillset.git");
    await expect(interactiveRepositoryDisplay(repository)).resolves.toBe(
      "outfitter-dev/skillset"
    );
    const directory = await mkdtemp(join(tmpdir(), "skillset-init-label-cwd-"));
    await expect(interactiveRepositoryDisplay(directory)).resolves.toBe(directory);
  });

  test("target defaults follow selected provider evidence", () => {
    const candidates = [
      {
        kind: "plugin" as const,
        path: ".codex/plugins/demo",
        plugin: {
          identity: "codex-demo",
          paths: [".codex/plugins/demo"],
          providers: ["codex" as const],
          relation: "single-source" as const,
        },
      },
    ];
    expect(
      interactiveTargetDefaults(selectedInteractiveCandidates(candidates, [
        "plugin:.codex/plugins/demo",
      ]))
    ).toEqual(["codex"]);
    expect(interactiveTargetDefaults([])).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
  });

  test("bare init immediately inspects the current Git repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-init-nested-root-"));
    const nested = join(root, "packages/demo");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "# Root instructions\n");
    await runGit(root, "init", "-q");
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "all" },
      { kind: "checkbox", value: ["claude", "codex", "cursor"] },
      { kind: "checkbox", value: [] },
      { kind: "confirm", value: false },
    ]);
    let rendered = "";

    const result = await runInteractiveInit(
      {
        directory: undefined,
        initAdopt: undefined,
        rootExplicit: false,
        rootPath: nested,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      { printPlan: (plan) => (rendered = formatInteractiveInitPlan(plan)) }
    );

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "select",
      "checkbox",
      "checkbox",
      "confirm",
    ]);
    expect(await realpath(result.report.rootPath)).toBe(await realpath(root));
    expect(rendered).toContain(
      `Initialize Skillset in ${await realpath(root)}`
    );
    expect(rendered).toContain("Import 1 instruction file");
    expect(await readdir(nested)).toEqual([]);
  });

  test("confirmed empty setup writes only after preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-init-confirmed-"));
    const { adapter, session } = scriptedSession([
      { kind: "checkbox", value: ["codex"] },
      { kind: "checkbox", value: [] },
      { kind: "confirm", value: true },
    ]);
    let existedAtPreview = true;
    const result = await runInteractiveInit(
      {
        directory: undefined,
        initAdopt: undefined,
        rootExplicit: true,
        rootPath: root,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      {
        printPlan: () => {
          existedAtPreview = Bun.file(join(root, "skillset.yaml")).size > 0;
        },
      }
    );
    adapter.assertComplete();
    expect(existedAtPreview).toBe(false);
    expect(result).toMatchObject({ kind: "setup", reason: "written" });
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain(
      "    - codex\n"
    );
  });
});

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd: root,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
}
