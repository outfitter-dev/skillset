import {
  isTargetName,
  targetNames,
} from "@skillset/core/internal/targets";
import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";

import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import {
  isNewSourceKind,
  parseSkillPresets,
  type NewSourceKind,
  type NewSourceScope,
} from "./new-source";
import {
  readImportKind,
  readImportProvider,
  type ImportKind,
  type ImportProvider,
} from "./source-arg-values";
import type { ImportCommandRequest, NewCommandRequest } from "./source-cli";

export interface ImportExplicitOptions {
  readonly from: ImportProvider | undefined;
  readonly json: boolean;
  readonly kind: ImportKind | undefined;
  readonly name: string | undefined;
  readonly root: string | undefined;
}

export const parseImportCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): ImportCommandRequest => {
  let index = 1;
  let sourcePath: string | undefined;
  let positionalProvider: ImportProvider | undefined;
  const first = args[index];
  if (first !== undefined && !first.startsWith("--")) {
    if (isImportKind(first)) {
      throw new Error("skillset: import kind must be passed with --kind");
    }
    if (isImportProvider(first)) {
      positionalProvider = first;
      index += 1;
      const path = args[index];
      if (path !== undefined && !path.startsWith("--")) {
        sourcePath = path;
        index += 1;
      }
    } else {
      sourcePath = first;
      index += 1;
    }
  }

  let buildMode: "all" | "updated" | undefined;
  let from = positionalProvider;
  let json = false;
  let kind: ImportKind | undefined;
  let name: string | undefined;
  let root: string | undefined;
  let scopes: SkillsetOptions["scopes"];
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
      case "--kind": {
        const next = readImportKind(reader.readRequiredOptionValue(option));
        if (kind !== undefined && kind !== next) {
          throw new Error(
            `skillset: conflicting import kinds ${kind} and ${next}`
          );
        }
        kind = next;
        break;
      }
      case "--from":
        from = readImportProvider(reader.readRequiredOptionValue(option));
        break;
      case "--json":
        assertBooleanOption(option);
        json = true;
        break;
      case "--yes":
        assertBooleanOption(option);
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
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }
  const explicit: ImportExplicitOptions = { from, json, kind, name, root };
  return {
    importKind: explicit.kind,
    importName: explicit.name,
    importProvider: explicit.from,
    jsonOutput: explicit.json,
    options: {
      ...(buildMode === undefined ? {} : { buildMode }),
      ...(scopes === undefined ? {} : { scopes }),
    },
    rootPath: resolveCliRoot(context, explicit.root),
    sourcePath,
  };
};

export interface NewExplicitOptions {
  readonly container: string | undefined;
  readonly displayName: string | undefined;
  readonly id: string | undefined;
  readonly json: boolean;
  readonly presets: readonly string[] | undefined;
  readonly root: string | undefined;
  readonly scope: NewSourceScope | undefined;
  readonly yes: boolean;
}

export const parseNewCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): NewCommandRequest => {
  const kind = readNewSourceKind(args[1]);
  let index = kind === undefined ? 1 : 2;
  let positionalName: string | undefined;
  const positional = args[index];
  if (positional !== undefined && !positional.startsWith("--")) {
    positionalName = positional;
    index += 1;
  }
  let container: string | undefined;
  let buildMode: "all" | "updated" | undefined;
  let displayName: string | undefined;
  let hookAttachment: string | undefined;
  let hookCommand: string | undefined;
  let hookEvents: string[] | undefined;
  let hookProviders: TargetName[] | undefined;
  let hookScript: string | undefined;
  let id: string | undefined;
  let importKind: ImportKind | undefined;
  let importProvider: ImportProvider | undefined;
  let json = false;
  let presets: readonly string[] | undefined;
  let root: string | undefined;
  let scope: NewSourceScope | undefined;
  let yes = false;
  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) break;
    switch (option.flag) {
      case "--root":
        root = reader.readRequiredOptionValue(option);
        break;
      case "--id":
        id = reader.readRequiredOptionValue(option);
        break;
      case "--name":
        displayName = reader.readRequiredOptionValue(option);
        break;
      case "--in":
        container = reader.readRequiredOptionValue(option);
        break;
      case "--attach":
        hookAttachment = reader.readRequiredOptionValue(option);
        break;
      case "--command":
        hookCommand = reader.readRequiredOptionValue(option);
        break;
      case "--event":
        hookEvents = [...(hookEvents ?? []), reader.readRequiredOptionValue(option)];
        break;
      case "--provider": {
        const value = reader.readRequiredOptionValue(option);
        if (!isTargetName(value)) {
          throw new Error(
            `skillset: expected --provider ${targetNames().join(", ")}`
          );
        }
        hookProviders = [...(hookProviders ?? []), value];
        break;
      }
      case "--script":
        hookScript = reader.readRequiredOptionValue(option);
        break;
      case "--preset":
        presets = [...(presets ?? []), reader.readRequiredOptionValue(option)];
        break;
      case "--scope":
        scope = readNewSourceScope(reader.readRequiredOptionValue(option));
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
        importKind = readImportKind(reader.readRequiredOptionValue(option));
        break;
      case "--from":
        importProvider = readImportProvider(
          reader.readRequiredOptionValue(option)
        );
        break;
      case "--updated":
      case "--all":
        assertBooleanOption(option);
        buildMode = mergeBuildMode(
          buildMode,
          option.flag === "--all" ? "all" : "updated"
        );
        break;
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }
  if (buildMode !== undefined) {
    throw new Error("skillset: --updated and --all are not supported with new");
  }
  if (importKind !== undefined) {
    throw new Error("skillset: --kind is only supported with import");
  }
  if (importProvider !== undefined) {
    throw new Error("skillset: --from is only supported with import");
  }
  const explicit: NewExplicitOptions = {
    container,
    displayName,
    id,
    json,
    presets: presets === undefined ? undefined : parseSkillPresets(presets),
    root,
    scope,
    yes,
  };
  return {
    ...(hookAttachment === undefined ? {} : { hookAttachment }),
    ...(hookCommand === undefined ? {} : { hookCommand }),
    ...(hookEvents === undefined ? {} : { hookEvents }),
    ...(hookProviders === undefined ? {} : { hookProviders }),
    ...(hookScript === undefined ? {} : { hookScript }),
    jsonOutput: explicit.json,
    newContainer: explicit.container,
    newId: explicit.id,
    newKind: kind,
    newName: explicit.displayName,
    newPresets: explicit.presets,
    newScope: explicit.scope,
    options: {},
    positionalName,
    rootPath: resolveCliRoot(context, explicit.root),
    yes: explicit.yes,
  };
};

const isImportKind = (value: string | undefined): value is ImportKind =>
  value === "skill" ||
  value === "skills" ||
  value === "plugin" ||
  value === "plugins";

const isImportProvider = (value: string | undefined): value is ImportProvider =>
  value === "agents" ||
  value === "claude" ||
  value === "codex" ||
  value === "cursor" ||
  value === "skillset";

const readNewSourceKind = (
  value: string | undefined
): NewSourceKind | undefined => {
  if (value === undefined || value.startsWith("--")) return undefined;
  return isNewSourceKind(value) ? value : undefined;
};

const readNewSourceScope = (value: string): NewSourceScope => {
  if (value === "repo") return value;
  throw new Error("skillset: new currently supports only --scope repo");
};
