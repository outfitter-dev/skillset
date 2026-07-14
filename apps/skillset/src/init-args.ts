import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  readTargetNames,
  resolveCliRoot,
  tokenizeCsv,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type { InitCommandRequest } from "./init-cli";
import type { SetupInclude } from "./setup";
import { readImportKind, type ImportKind } from "./source-arg-values";

export interface InitExplicitOptions {
  readonly adopt: readonly string[] | undefined;
  readonly from: string | undefined;
  readonly include: readonly SetupInclude[] | undefined;
  readonly json: boolean;
  readonly name: string | undefined;
  readonly root: string | undefined;
  readonly targets: readonly TargetName[] | undefined;
  readonly yes: boolean;
}

export const parseInitCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): InitCommandRequest => {
  let destination: string | undefined;
  let index = 1;
  const positional = args[index];
  if (positional !== undefined && !positional.startsWith("--")) {
    destination = positional;
    index += 1;
  }

  let adopt: readonly string[] | undefined;
  let buildMode: "all" | "updated" | undefined;
  let from: string | undefined;
  let include: readonly SetupInclude[] | undefined;
  let json = false;
  let name: string | undefined;
  let root: string | undefined;
  let scopes: SkillsetOptions["scopes"];
  let targets: readonly TargetName[] | undefined;
  let yes = false;
  let ignoredKind: ImportKind | undefined;
  const reader = new CliArgReader(args, index);

  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) break;
    switch (option.flag) {
      case "--root":
        root = reader.readRequiredOptionValue(option);
        break;
      case "--name":
        name = reader.readRequiredOptionValue(option);
        break;
      case "--from":
        from = reader.readRequiredOptionValue(option);
        break;
      case "--adopt":
        adopt = [...(adopt ?? []), reader.readRequiredOptionValue(option)];
        break;
      case "--targets":
        targets = readTargetNames(reader.readRequiredOptionValue(option));
        break;
      case "--include":
        include = mergeSetupIncludes(
          include,
          reader.readRequiredOptionValue(option)
        );
        break;
      case "--yes":
        assertBooleanOption(option);
        yes = true;
        break;
      case "--json":
        assertBooleanOption(option);
        json = true;
        break;
      case "--kind":
        ignoredKind = readImportKind(reader.readRequiredOptionValue(option));
        break;
      case "--updated":
      case "--all":
        assertBooleanOption(option);
        buildMode = mergeBuildMode(
          buildMode,
          option.flag === "--all" ? "all" : "updated"
        );
        break;
      case "--scope":
        scopes = readBuildScopes(reader.readRequiredOptionValue(option));
        break;
      case "--isolated":
        assertBooleanOption(option);
        throw new Error(
          "skillset: --isolated is only supported with build, check --only outputs, or diff"
        );
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }

  void ignoredKind;
  if (buildMode !== undefined || scopes !== undefined) {
    throw new Error(
      "skillset: build mode and scope flags are not supported with adopt; adoption always builds the full projection isolated"
    );
  }
  const explicit: InitExplicitOptions = {
    adopt,
    from,
    include,
    json,
    name,
    root,
    targets,
    yes,
  };
  return createInitCommandRequest(destination, explicit, context);
};

const createInitCommandRequest = (
  destination: string | undefined,
  explicit: InitExplicitOptions,
  context: CliParseContext
): InitCommandRequest => ({
  destination,
  importName: explicit.name,
  initAdopt: explicit.adopt,
  initFrom: explicit.from,
  jsonOutput: explicit.json,
  options: {},
  rootExplicit: explicit.root !== undefined,
  rootPath: resolveCliRoot(context, explicit.root),
  setupIncludes: explicit.include,
  setupTargets: explicit.targets,
  yes: explicit.yes,
});

const mergeSetupIncludes = (
  current: readonly SetupInclude[] | undefined,
  value: string
): readonly SetupInclude[] => {
  const includes = tokenizeCsv(value);
  if (includes.length === 0) {
    throw new Error("skillset: --include requires at least one value");
  }
  const seen = new Set<SetupInclude>(current ?? []);
  for (const include of includes) {
    if (include !== "ci") {
      throw new Error("skillset: expected --include ci");
    }
    seen.add(include);
  }
  return [...seen];
};
