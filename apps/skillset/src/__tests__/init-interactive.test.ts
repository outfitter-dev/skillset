import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  interactiveTargetDefaults,
  promptForInteractiveCandidates,
  runInteractiveInit,
  selectInteractiveCandidateIds,
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
  const session = createInteractiveSession({
    adapter,
    env: { CI: "false" },
    input: ttyInput(),
    output: ttyOutput(),
  });
  if (session === undefined) throw new Error("expected interactive session");
  return { adapter, session };
}

describe("SET-292 derived init choices", () => {
  test("normalizes all, individual, and scaffold-only candidate choices", () => {
    const candidates = [
      { kind: "instructions" as const, path: "AGENTS.md" },
      { kind: "skills" as const, path: ".agents/skills" },
    ];
    expect(selectInteractiveCandidateIds(candidates, ["all"])).toEqual([
      "instructions:AGENTS.md",
      "skills:.agents/skills",
    ]);
    expect(
      selectInteractiveCandidateIds(candidates, ["skills:.agents/skills"])
    ).toEqual(["skills:.agents/skills"]);
    expect(
      selectInteractiveCandidateIds(candidates, [
        "all",
        "skills:.agents/skills",
      ])
    ).toEqual(["skills:.agents/skills"]);
    expect(selectInteractiveCandidateIds(candidates, [])).toEqual([]);
    expect(selectInteractiveCandidateIds([], [])).toEqual([]);
  });

  test("large adoption inventories use searchable multi-select with stable actions", async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      kind: "plugin" as const,
      path: `.claude/plugins/plugin-${index}`,
    }));
    const selectedIds = [
      "plugin:.claude/plugins/plugin-2",
      "plugin:.claude/plugins/plugin-7",
    ];
    const { adapter, session } = scriptedSession([
      { kind: "search-checkbox", value: selectedIds },
    ]);

    await expect(
      promptForInteractiveCandidates(candidates, session)
    ).resolves.toEqual(selectedIds);
    adapter.assertComplete();
    const prompt = adapter.prompts[0];
    if (prompt?.kind !== "search-checkbox") {
      throw new Error("expected searchable candidate prompt");
    }
    expect(prompt.prompt.choices).toHaveLength(9);
    expect(prompt.prompt.choices[0]).toEqual(
      expect.objectContaining({ checked: true, value: "all" })
    );
    expect(
      prompt.prompt
        .source("plugin-7", prompt.prompt.choices)
        .map((choice) => choice.value)
    ).toEqual(["all", "plugin:.claude/plugins/plugin-7"]);
  });

  test("target defaults follow selected providers and reset for scaffold-only", () => {
    const providerCandidate = (provider: "claude" | "codex") => ({
      kind: "plugin" as const,
      path: `.${provider}/plugins/demo`,
      plugin: {
        identity: `${provider}-demo`,
        paths: [`.${provider}/plugins/demo`],
        providers: [provider],
        relation: "single-source" as const,
      },
    });

    const candidates = [
      providerCandidate("claude"),
      providerCandidate("codex"),
    ];
    const codexOnly = selectedInteractiveCandidates(candidates, [
      "plugin:.codex/plugins/demo",
    ]);
    const scaffoldOnly = selectedInteractiveCandidates(candidates, []);

    expect(interactiveTargetDefaults(codexOnly)).toEqual(["codex"]);
    expect(interactiveTargetDefaults(scaffoldOnly)).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
  });

  test("current mode pins the surveyed Git root from a nested directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-init-nested-root-"));
    const nested = join(root, "packages/demo");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "# Root instructions\n");
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: root }).exitCode).toBe(
      0
    );
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "current" },
      { kind: "checkbox", value: ["all"] },
      { kind: "checkbox", value: ["claude", "codex", "cursor"] },
      { kind: "checkbox", value: [] },
      { kind: "confirm", value: false },
    ]);
    let plannedRoot = "";

    await runInteractiveInit(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: undefined,
        initFrom: undefined,
        rootExplicit: false,
        rootPath: nested,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      { printPlan: (plan) => (plannedRoot = plan.report.rootPath) }
    );

    adapter.assertComplete();
    expect(await realpath(plannedRoot)).toBe(await realpath(root));
    expect(await readdir(nested)).toEqual([]);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
  });

  test("preset adoption resolves the Git root from a nested directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-init-nested-adopt-"));
    const nested = join(root, "packages/demo");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "# Root instructions\n");
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: root }).exitCode).toBe(
      0
    );
    const { adapter, session } = scriptedSession([
      { kind: "checkbox", value: ["claude", "codex", "cursor"] },
      { kind: "checkbox", value: [] },
      { kind: "confirm", value: false },
    ]);
    let plannedRoot = "";
    let plannedCandidates: readonly string[] = [];

    await runInteractiveInit(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: ["all"],
        initFrom: undefined,
        rootExplicit: false,
        rootPath: nested,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      {
        printPlan: (plan) => {
          plannedRoot = plan.report.rootPath;
          if (plan.kind === "adopt") {
            plannedCandidates = plan.report.candidates.map(
              (candidate) => `${candidate.kind}:${candidate.path}`
            );
          }
        },
      }
    );

    adapter.assertComplete();
    expect(await realpath(plannedRoot)).toBe(await realpath(root));
    expect(plannedCandidates).toContain("instructions:AGENTS.md");
    expect(await readdir(nested)).toEqual([]);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
  });

  test("preset adoption copies the current repository into a positional destination", async () => {
    const base = await mkdtemp(join(tmpdir(), "skillset-init-adopt-destination-"));
    const root = join(base, "source");
    const destination = join(base, "imported");
    await mkdir(root);
    await writeFile(join(root, "AGENTS.md"), "# Root instructions\n");
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: root }).exitCode).toBe(
      0
    );
    const { adapter, session } = scriptedSession([
      { kind: "confirm", value: true },
    ]);

    const result = await runInteractiveInit(
      {
        destination: "../imported",
        importName: undefined,
        initAdopt: ["all"],
        initFrom: undefined,
        rootExplicit: false,
        rootPath: root,
        setupIncludes: [],
        setupTargets: ["codex"],
      },
      session,
      { printPlan: () => undefined }
    );

    adapter.assertComplete();
    expect(result).toMatchObject({ kind: "adopt", reason: "written" });
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(destination, "skillset.yaml")).exists()).toBe(
      true
    );
    expect(
      await Bun.file(join(destination, ".skillset/rules/agents.md")).exists()
    ).toBe(true);
  });

  test("bare create prompts for mode and destination, then previews before default-No", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillset-init-create-"));
    const destination = join(cwd, "new-workspace");
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "create" },
      { kind: "input", value: "new-workspace" },
      { kind: "checkbox", value: ["claude", "codex", "cursor"] },
      { kind: "checkbox", value: ["ci"] },
      { kind: "confirm", value: false },
    ]);
    const events: string[] = [];

    const result = await runInteractiveInit(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: undefined,
        initFrom: undefined,
        rootExplicit: false,
        rootPath: cwd,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      {
        printPlan: (plan) =>
          events.push(`${plan.kind}:${plan.report.rootPath}`),
      }
    );

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "select",
      "input",
      "checkbox",
      "checkbox",
      "confirm",
    ]);
    const targetPrompt = adapter.prompts[2];
    expect(targetPrompt?.kind).toBe("checkbox");
    if (targetPrompt?.kind === "checkbox") {
      expect(targetPrompt.prompt.choices.map((choice) => choice.value)).toEqual(
        ["claude", "codex", "cursor"]
      );
      expect(targetPrompt.prompt.required).toBe(true);
    }
    const integrationPrompt = adapter.prompts[3];
    expect(integrationPrompt?.kind).toBe("checkbox");
    if (integrationPrompt?.kind === "checkbox") {
      expect(integrationPrompt.prompt.choices).toEqual([
        expect.objectContaining({ checked: true, value: "ci" }),
      ]);
    }
    expect(events).toEqual([`setup:${destination}`]);
    expect(result.reason).toBe("write confirmation declined");
    expect(await readdir(cwd)).toEqual([]);
  });

  test("local import derives multiple candidates and leaves destination untouched when declined", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillset-init-import-cwd-"));
    const source = await mkdtemp(
      join(tmpdir(), "skillset-init-import-source-")
    );
    const destination = join(cwd, "imported");
    await writeFile(join(source, "AGENTS.md"), "# Existing instructions\n");
    await mkdir(join(source, ".agents/skills/demo"), { recursive: true });
    await writeFile(
      join(source, ".agents/skills/demo/SKILL.md"),
      "---\nname: demo\ndescription: Demo.\n---\n\nDemo.\n"
    );
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "import" },
      { kind: "input", value: "imported" },
      { kind: "input", value: source },
      { kind: "checkbox", value: ["all"] },
      { kind: "checkbox", value: ["claude", "codex", "cursor"] },
      { kind: "checkbox", value: [] },
      { kind: "confirm", value: false },
    ]);
    let plannedCandidates: readonly string[] = [];

    const result = await runInteractiveInit(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: undefined,
        initFrom: undefined,
        rootExplicit: false,
        rootPath: cwd,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      {
        printPlan: (plan) => {
          if (plan.kind === "adopt") {
            plannedCandidates = plan.report.candidates.map(
              (candidate) => `${candidate.kind}:${candidate.path}`
            );
          }
        },
      }
    );

    adapter.assertComplete();
    expect(plannedCandidates).toEqual([
      "instructions:AGENTS.md",
      "skills:.agents/skills",
    ]);
    expect(result.kind).toBe("adopt");
    expect(result.reason).toBe("write confirmation declined");
    expect(await readdir(cwd)).toEqual([]);
    expect(destination).not.toBe(source);
  });

  test("explicit source, destination, targets, includes, and adoption bypass matching prompts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillset-init-explicit-cwd-"));
    const source = await mkdtemp(
      join(tmpdir(), "skillset-init-explicit-source-")
    );
    await writeFile(join(source, "AGENTS.md"), "# Existing instructions\n");
    const { adapter, session } = scriptedSession([
      { kind: "confirm", value: false },
    ]);

    await runInteractiveInit(
      {
        destination: "imported",
        importName: undefined,
        initAdopt: ["instructions:AGENTS.md"],
        initFrom: source,
        rootExplicit: false,
        rootPath: cwd,
        setupIncludes: [],
        setupTargets: ["codex"],
      },
      session,
      { printPlan: () => undefined }
    );

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual(["confirm"]);
  });

  test("confirmed scaffold-only setup writes only after the plan callback", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-init-confirmed-"));
    const { adapter, session } = scriptedSession([
      { kind: "checkbox", value: ["codex"] },
      { kind: "checkbox", value: [] },
      { kind: "confirm", value: true },
    ]);
    let workspaceExistedAtPlan = true;

    const result = await runInteractiveInit(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: undefined,
        initFrom: undefined,
        rootExplicit: true,
        rootPath: root,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      {
        printPlan: () => {
          workspaceExistedAtPlan = existsSync(join(root, "skillset.yaml"));
        },
      }
    );

    adapter.assertComplete();
    expect(workspaceExistedAtPlan).toBe(false);
    expect(result).toMatchObject({ kind: "setup", reason: "written" });
    expect(await readdir(root)).toContain("skillset.yaml");
  });

  test("confirmed individual adoption forwards targets and integrations", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-init-individual-"));
    await writeFile(join(root, "AGENTS.md"), "# Existing instructions\n");
    await mkdir(join(root, ".agents/skills/demo"), { recursive: true });
    await writeFile(
      join(root, ".agents/skills/demo/SKILL.md"),
      "---\nname: demo\ndescription: Demo.\n---\n\nDemo.\n"
    );
    const { adapter, session } = scriptedSession([
      { kind: "checkbox", value: ["instructions:AGENTS.md"] },
      { kind: "checkbox", value: ["codex"] },
      { kind: "checkbox", value: ["ci"] },
      { kind: "confirm", value: true },
    ]);

    const result = await runInteractiveInit(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: undefined,
        initFrom: undefined,
        rootExplicit: true,
        rootPath: root,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      { printPlan: () => undefined }
    );

    adapter.assertComplete();
    expect(result).toMatchObject({ kind: "adopt", reason: "written" });
    if (result.kind !== "adopt") throw new Error("expected adopt result");
    expect(result.report.candidates.map((candidate) => candidate.path)).toEqual(
      ["AGENTS.md"]
    );
    expect(
      await Bun.file(join(root, ".skillset/rules/agents.md")).exists()
    ).toBe(true);
    expect(
      await Bun.file(join(root, ".skillset/skills/demo/SKILL.md")).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".github/workflows/skillset-ci.yml")).exists()
    ).toBe(true);
    expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain(
      "    - codex\n"
    );
  });

  test("confirmed remote adopt-all reuses the exact surveyed acquisition", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "skillset-init-remote-cwd-"));
    const source = await mkdtemp(
      join(tmpdir(), "skillset-init-remote-source-")
    );
    await writeFile(join(source, "AGENTS.md"), "# Remote instructions\n");
    for (const args of [
      ["init", "-q"],
      ["add", "AGENTS.md"],
      [
        "-c",
        "user.name=Skillset Test",
        "-c",
        "user.email=skillset@example.com",
        "commit",
        "-qm",
        "initial",
      ],
    ]) {
      expect(Bun.spawnSync(["git", ...args], { cwd: source }).exitCode).toBe(0);
    }
    const destination = join(cwd, "imported");
    const { adapter, session } = scriptedSession([
      { kind: "checkbox", value: ["all"] },
      { kind: "checkbox", value: ["codex"] },
      { kind: "checkbox", value: [] },
      { kind: "confirm", value: true },
    ]);
    let plannedRef = "";
    let advancedRef = "";

    const result = await runInteractiveInit(
      {
        destination: "imported",
        importName: undefined,
        initAdopt: undefined,
        initFrom: `file://${source}`,
        rootExplicit: false,
        rootPath: cwd,
        setupIncludes: undefined,
        setupTargets: undefined,
      },
      session,
      {
        printPlan: (plan) => {
          if (plan.kind === "adopt" && plan.report.acquisition.kind === "git") {
            plannedRef = plan.report.acquisition.ref;
            writeFileSync(
              join(source, "AGENTS.md"),
              "# Advanced after preview\n"
            );
            for (const args of [
              ["add", "AGENTS.md"],
              [
                "-c",
                "user.name=Skillset Test",
                "-c",
                "user.email=skillset@example.com",
                "commit",
                "-qm",
                "advance after preview",
              ],
            ]) {
              if (
                Bun.spawnSync(["git", ...args], { cwd: source }).exitCode !== 0
              ) {
                throw new Error("failed to advance remote fixture");
              }
            }
            advancedRef = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
              cwd: source,
            })
              .stdout.toString()
              .trim();
          }
        },
      }
    );

    adapter.assertComplete();
    expect(result).toMatchObject({ kind: "adopt", reason: "written" });
    if (result.kind !== "adopt" || result.report.acquisition.kind !== "git") {
      throw new Error("expected Git adoption result");
    }
    expect(result.report.acquisition.ref).toBe(plannedRef);
    expect(result.report.acquisition.ref).not.toBe(advancedRef);
    expect(result.report.rootPath).toBe(destination);
    expect(
      await Bun.file(join(destination, ".skillset/rules/agents.md")).exists()
    ).toBe(true);
    expect(await readFile(join(destination, "AGENTS.md"), "utf8")).toBe(
      "# Remote instructions\n"
    );
  });
});
