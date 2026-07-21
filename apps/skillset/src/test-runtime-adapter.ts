import {
  evaluateSkillsetTestRuntime,
  slugifySkillsetTestProbeName,
  type SkillsetRuntimeProbeRequest,
  type SkillsetRuntimeTestResult as CoreSkillsetRuntimeTestResult,
  type SkillsetTestDeclaration,
} from "@skillset/core/internal/test-evaluation";
import type {
  JsonRecord,
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import {
  readTryEvidence,
  readTryStatus,
  startTryRun,
  type TryState,
} from "./try";

export interface SkillsetRuntimeTestAdapterOptions extends SkillsetOptions {
  readonly runtimeEnv?: Record<string, string | undefined>;
}

export interface SkillsetRuntimeTestResult extends JsonRecord {
  readonly assertions: CoreSkillsetRuntimeTestResult["assertions"][number][];
  readonly command: string[];
  readonly detail?: string;
  readonly failureClass?: CoreSkillsetRuntimeTestResult["failureClass"];
  readonly name: string;
  readonly ok: boolean;
  readonly outputPath?: string;
  readonly promptPath?: string;
  readonly promptProvenance: string;
  readonly reportPath?: string;
  readonly runId?: string;
  readonly runPath?: string;
  readonly state: TryState;
  readonly target: TargetName;
}

interface RuntimeTestEvidence {
  readonly outputPath: string;
  readonly promptPath: string;
  readonly reportPath: string;
  readonly runId: string;
  readonly runPath: string;
  readonly state: TryState;
}

/**
 * Bridges Core's policy-neutral probe contract to the app-owned retained
 * runtime lifecycle. Process execution and retained evidence stay in the app;
 * Core evaluates rendered units and literal assertions only.
 */
export async function runDeclaredRuntimeTests(
  rootPath: string,
  workspacePath: string,
  declaration: SkillsetTestDeclaration,
  options: SkillsetRuntimeTestAdapterOptions
): Promise<readonly SkillsetRuntimeTestResult[]> {
  const evidenceByProbe = new Map<string, RuntimeTestEvidence>();
  const keyFor = (
    request: Pick<SkillsetRuntimeProbeRequest, "name" | "target">
  ): string => `${request.name}\0${request.target}`;

  const runtimeTests = await evaluateSkillsetTestRuntime(
    workspacePath,
    declaration,
    options,
    {
      run: async (request) => {
        const run = await startTryRun(workspacePath, {
          cacheRootPath: rootPath,
          ...(request.claudeSettingSources === undefined
            ? {}
            : { claudeSettingSources: request.claudeSettingSources }),
          ...(options.runtimeEnv === undefined
            ? {}
            : { env: options.runtimeEnv }),
          name: request.name,
          prompt: request.prompt,
          target: request.target,
          ...(request.timeoutMs === undefined
            ? {}
            : { timeoutMs: request.timeoutMs }),
          ...(options.xdg === undefined ? {} : { xdg: options.xdg }),
        });
        const status = await readTryStatus(rootPath, run.runId, options);
        const evidence = await readTryEvidence(rootPath, run.runId, options);
        evidenceByProbe.set(keyFor(request), {
          outputPath: evidence.outputPath,
          promptPath: status.promptPath,
          reportPath: evidence.reportPath,
          runId: run.runId,
          runPath: run.runPath,
          state: status.state,
        });
        return {
          command: status.command ?? [],
          ...(status.error === undefined ? {} : { detail: status.error }),
          ...(status.failureClass === undefined
            ? {}
            : { failureClass: status.failureClass }),
          response: evidence.response,
          state: status.state === "passed" ? "passed" : "failed",
        };
      },
    }
  );

  return runtimeTests.map((result) => {
    const evidence = evidenceByProbe.get(
      `${declaration.name}-${slugifySkillsetTestProbeName(result.name)}-${result.target}\0${result.target}`
    );
    return toSkillsetRuntimeTestResult(result, evidence);
  });
}

export function toSkillsetRuntimeTestResult(
  result: CoreSkillsetRuntimeTestResult,
  evidence?: RuntimeTestEvidence
): SkillsetRuntimeTestResult {
  return {
    assertions: [...result.assertions],
    command: [...result.command],
    ...(result.detail === undefined ? {} : { detail: result.detail }),
    ...(result.failureClass === undefined
      ? {}
      : { failureClass: result.failureClass }),
    name: result.name,
    ok: result.ok,
    ...(evidence === undefined
      ? {}
      : {
          outputPath: evidence.outputPath,
          promptPath: evidence.promptPath,
          reportPath: evidence.reportPath,
          runId: evidence.runId,
          runPath: evidence.runPath,
        }),
    promptProvenance: result.promptProvenance,
    state: evidence?.state ?? (result.state === "passed" ? "passed" : "failed"),
    target: result.target,
  };
}
