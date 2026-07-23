import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { validateSkillEval } from "@skillset/schema";

import { compareStrings } from "./path";
import type {
  JsonRecord,
  SourceSkillEval,
  SourceSkillEvalCase,
  TargetName,
} from "./types";
import { isJsonRecord } from "./yaml";

const EVAL_FILE = join("evals", "evals.json");

/**
 * Loads the one portable eval document supported by a skill. It does not run a
 * provider or create a workspace: source validation is deliberately separate
 * from machine-local evaluation execution.
 */
export async function loadSkillEvalDeclaration(
  skillPath: string,
  skillId: string,
  targets: Readonly<Record<TargetName, { readonly enabled: boolean }>>
): Promise<SourceSkillEval | undefined> {
  const evalPath = join(skillPath, EVAL_FILE);
  let content: string;
  try {
    content = await readFile(evalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: ${evalPath} must contain valid JSON: ${detail}`);
  }
  const files = await listSkillFiles(skillPath);
  const enabledTargets = (Object.entries(targets) as readonly [TargetName, { readonly enabled: boolean }][])
    .filter(([, target]) => target.enabled)
    .map(([target]) => target);
  const validation = validateSkillEval(document, evalPath, {
    files,
    skillName: skillId,
    targets: enabledTargets,
  });
  if (!validation.ok) {
    throw new Error(
      `skillset: ${evalPath} failed schema validation: ${validation.diagnostics.map((item) => item.message).join("; ")}`
    );
  }
  if (!isJsonRecord(document) || !Array.isArray(document.evals)) {
    throw new Error(`skillset: ${evalPath} did not produce eval cases`);
  }

  return {
    cases: document.evals.map((entry) => readEvalCase(entry, enabledTargets)),
    relativePath: EVAL_FILE.replaceAll("\\", "/"),
  };
}

function readEvalCase(
  value: unknown,
  defaultTargets: readonly TargetName[]
): SourceSkillEvalCase {
  if (!isJsonRecord(value)) throw new Error("skillset: validated eval case must be an object");
  const extension = isJsonRecord(value.skillset) ? value.skillset : undefined;
  const targets = Array.isArray(extension?.targets)
    ? extension.targets as TargetName[]
    : defaultTargets;
  return {
    expectedOutput: String(value.expected_output),
    expectations: readStringArray(value.expectations),
    files: readStringArray(value.files),
    id: Number(value.id),
    prompt: String(value.prompt),
    targets,
  };
}

function readStringArray(value: JsonRecord[string] | undefined): readonly string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

async function listSkillFiles(skillPath: string): Promise<ReadonlySet<string>> {
  const paths = await listFiles(skillPath, skillPath);
  return new Set(paths);
}

async function listFiles(root: string, path: string): Promise<readonly string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(relative(root, entryPath).split(sep).join("/"));
    }
  }
  return files.sort(compareStrings);
}
