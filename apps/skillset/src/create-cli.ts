import { resolve } from "node:path";

import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import { rememberKnownSkillsetWorkspace } from "./cli-known-workspaces";
import { printCliJsonData } from "./cli-output";
import {
  formatInteractiveCreatePlan,
  normalizeCreateName,
  runInteractiveCreate,
} from "./create-interactive";
import { printSetupReport } from "./init-cli";
import {
  createInteractiveSession,
  type InteractiveSession,
} from "./interactive-session";
import { createSkillset, type SetupInclude } from "./setup";

export interface CreateCommandRequest {
  readonly jsonOutput: boolean;
  readonly name: string | undefined;
  readonly options: SkillsetOptions;
  readonly parentExplicit: boolean;
  readonly parentPath: string;
  readonly setupIncludes: readonly SetupInclude[] | undefined;
  readonly setupTargets: readonly TargetName[] | undefined;
  readonly yes: boolean;
}

export interface CreateCommandContext {
  readonly interactiveSession?: InteractiveSession;
}

export async function runCreateCommand(
  request: CreateCommandRequest,
  context: CreateCommandContext = {}
): Promise<void> {
  const interactiveSession = request.jsonOutput
    ? undefined
    : (context.interactiveSession ?? createInteractiveSession());
  if (!request.yes && interactiveSession !== undefined) {
    interactiveSession.banner();
    const result = await runInteractiveCreate(request, interactiveSession, {
      printPlan: (plan) => interactiveSession.note(
        formatInteractiveCreatePlan(plan),
        "Skillset will"
      ),
    });
    if (result.reason === "written") {
      printSetupReport(result.report, result.reason);
      await rememberKnownSkillsetWorkspace(result.report.rootPath, request.options);
    }
    return;
  }

  if (request.name === undefined) {
    throw new Error("skillset: create requires a name outside an interactive terminal");
  }
  const name = normalizeCreateName(request.name);
  const parentPath = resolve(request.parentPath);
  const report = await createSkillset({
    cwd: parentPath,
    ...(request.setupIncludes === undefined
      ? {}
      : { include: request.setupIncludes }),
    name,
    rootPath: resolve(parentPath, name),
    ...(request.setupTargets === undefined
      ? {}
      : { targets: request.setupTargets }),
    write: request.yes,
  });
  if (request.jsonOutput && request.yes) {
    await rememberKnownSkillsetWorkspace(report.rootPath, request.options, true);
  }
  if (request.jsonOutput) {
    const writes = request.yes
      ? [
          ...report.files
            .filter((file) => file.status === "create")
            .map((file) => file.path),
          ...(report.git?.status === "create" ? [report.git.path] : []),
        ]
      : [];
    printCliJsonData("create", {
      report,
      state: writes.length > 0 ? "written" : "planned",
      writes,
    });
  } else {
    printSetupReport(
      report,
      request.yes ? "written" : "write confirmation required"
    );
    if (!request.yes) {
      console.log("skillset: rerun create with --yes to write setup files");
    }
  }
  if (!request.jsonOutput && request.yes) {
    await rememberKnownSkillsetWorkspace(report.rootPath, request.options);
  }
}
