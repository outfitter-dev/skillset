import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildSkillsetResult,
  diffSkillset,
  diffSkillsetResult,
  verifySkillsetResult,
} from "@skillset/core";

type QuietCoreScenario = "consumer" | "diff";

export interface QuietCoreProcessResult {
  readonly evidence: unknown;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export const runQuietCoreProcess = async (
  scenario: QuietCoreScenario,
  root: string
): Promise<QuietCoreProcessResult> => {
  const evidenceRoot = await mkdtemp(
    path.join(tmpdir(), "skillset-core-quiet-")
  );
  const evidencePath = path.join(evidenceRoot, "evidence.json");
  try {
    const proc = Bun.spawn(
      [process.execPath, import.meta.filename, scenario, root, evidencePath],
      {
        cwd: process.cwd(),
        env: process.env,
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const evidence =
      exitCode === 0
        ? JSON.parse(await readFile(evidencePath, "utf-8"))
        : undefined;
    return { evidence, exitCode, stderr, stdout };
  } finally {
    await rm(evidenceRoot, { force: true, recursive: true });
  }
};

const diffEvidence = async (root: string): Promise<Record<string, unknown>> => {
  const result = await diffSkillsetResult(root);
  return {
    diff: await diffSkillset(root),
    outputExists: await Bun.file(
      path.join(root, ".claude/skills/demo/SKILL.md")
    ).exists(),
    result,
  };
};

const consumerEvidence = async (
  root: string
): Promise<Record<string, unknown>> => {
  const outputPath = path.join(root, ".claude/skills/demo/SKILL.md");
  const preview = await diffSkillsetResult(root);
  const previewOutputExists = await Bun.file(outputPath).exists();
  const build = await buildSkillsetResult(root);
  const verified = await verifySkillsetResult(root);
  const clean = await diffSkillsetResult(root);
  return { build, clean, preview, previewOutputExists, verified };
};

const runChild = async (
  scenario: QuietCoreScenario,
  root: string,
  evidencePath: string
): Promise<void> => {
  const cwdBefore = process.cwd();
  const evidence =
    scenario === "diff"
      ? await diffEvidence(root)
      : await consumerEvidence(root);
  await Bun.write(
    evidencePath,
    JSON.stringify({
      ...evidence,
      cwdAfter: process.cwd(),
      cwdBefore,
      processExitCode: process.exitCode ?? null,
    })
  );
};

if (import.meta.main) {
  const [scenario, root, evidencePath] = process.argv.slice(2);
  if (
    (scenario !== "consumer" && scenario !== "diff") ||
    root === undefined ||
    evidencePath === undefined
  ) {
    throw new Error(
      "skillset: expected quiet Core scenario, root, and evidence path"
    );
  }
  await runChild(scenario, root, evidencePath);
}
