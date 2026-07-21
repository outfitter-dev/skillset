import type { LookupView } from "@skillset/core";
import type { TargetName } from "@skillset/core/internal/types";

import { readChangeBump, setChangeReason } from "./change-args";
import type { ChangeReasonInput } from "./change-workflow";
import {
  assertBooleanOption,
  CliArgReader,
  type CliOptionToken,
} from "./cli-arg-reader";
import {
  mergeBuildMode,
  readClaudeSettingSources,
  readPositiveInteger,
  readTargetName,
  readTargetNames,
  tokenizeCsv,
} from "./cli-arg-values";
import type {
  LookupFeaturesCommandRequest,
  LookupRouteRequest,
} from "./inspect-cli";
import {
  addLookupTargets,
  addLookupView,
  readLookupSubject,
  setLookupField,
} from "./lookup-cli";
import {
  readHookRuntimeContextField,
  readHookRuntimeContextFormat,
} from "./runtime-hooks";
import { readImportKind, readImportProvider } from "./source-arg-values";

export type LookupCommandRequest =
  | { readonly kind: "features"; readonly value: LookupFeaturesCommandRequest }
  | { readonly kind: "query"; readonly value: LookupRouteRequest };

export const parseLookupCommandRequest = (
  args: readonly string[]
): LookupCommandRequest => {
  let index = 1;
  let featureId: string | undefined;
  let features = false;
  let lookupAspects: string[] = [];
  let lookupField: string | undefined;
  let lookupSubject: ReturnType<typeof readLookupSubject> | undefined;
  let lookupTargets: TargetName[] = [];
  let lookupViews: LookupView[] = [];
  let jsonOutput = false;
  let featureOption = false;
  let rootExplicit = false;
  let ignoredBuildMode: "all" | "updated" | undefined;
  const foreign = createLookupForeignFlags();

  const first = args[index];
  if (first === "features") {
    features = true;
    index += 1;
    const value = args[index];
    if (value !== undefined && !value.startsWith("--")) {
      featureId = value;
      index += 1;
    }
  } else if (first !== undefined && !first.startsWith("--")) {
    lookupSubject = readLookupSubject(first);
    index += 1;
    while (args[index] !== undefined && !args[index]?.startsWith("--")) {
      const aspect = args[index];
      if (aspect !== undefined) {
        lookupAspects = [...lookupAspects, aspect];
      }
      index += 1;
    }
  }

  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) {
      break;
    }
    if (features && option.flag !== "--json") {
      featureOption = true;
    }
    if (readLookupForeignOption(reader, option, foreign)) {
      continue;
    }
    switch (option.flag) {
      case "--compat": {
        lookupViews = addLookupView(lookupViews, "compat");
        for (const value of reader.readOptionalOptionValues(option)) {
          lookupTargets = addLookupTargets(lookupTargets, value);
        }
        break;
      }
      case "--frontmatter":
      case "--fields":
      case "--values":
      case "--events":
      case "--examples":
      case "--schema": {
        assertBooleanOption(option);
        lookupViews = addLookupView(
          lookupViews,
          option.flag.slice(2) as LookupView
        );
        break;
      }
      case "--field": {
        lookupField = setLookupField(
          lookupField,
          reader.readRequiredOptionValue(option)
        );
        break;
      }
      case "--json": {
        assertBooleanOption(option);
        jsonOutput = true;
        break;
      }
      case "--scope":
      case "--name":
        reader.readRequiredOptionValue(option);
        break;
      case "--kind":
        readImportKind(reader.readRequiredOptionValue(option));
        break;
      case "--from": {
        readImportProvider(reader.readRequiredOptionValue(option));
        break;
      }
      case "--updated":
      case "--all":
        assertBooleanOption(option);
        ignoredBuildMode = mergeBuildMode(
          ignoredBuildMode,
          option.flag === "--all" ? "all" : "updated"
        );
        break;
      case "--yes": {
        assertBooleanOption(option);
        break;
      }
      case "--root": {
        reader.readRequiredOptionValue(option);
        rootExplicit = true;
        break;
      }
      default: {
        throw new Error(`skillset: unknown option ${option.raw}`);
      }
    }
  }

  validateLookupForeignFlags(foreign);

  if (features) {
    if (
      lookupField !== undefined ||
      lookupTargets.length > 0 ||
      lookupViews.length > 0 ||
      featureOption ||
      foreign.isolated ||
      foreign.newSource ||
      foreign.reconcile ||
      rootExplicit
    ) {
      throw new Error(
        "skillset: expected lookup features to use only an optional feature id and --json"
      );
    }
    return { kind: "features", value: { featureId, jsonOutput } };
  }
  if (rootExplicit) {
    throw new Error("skillset: --root is not supported with lookup");
  }
  validateLookupLateFlags(foreign);
  return {
    kind: "query",
    value: {
      jsonOutput,
      lookupAspects,
      lookupField,
      lookupSubject,
      lookupTargets,
      lookupViews,
    },
  };
};

interface LookupForeignFlags {
  adopt: boolean;
  change: boolean;
  changeReason?: ChangeReasonInput;
  hookContext: boolean;
  hookPrint: boolean;
  isolated: boolean;
  jsonl: boolean;
  newSource: boolean;
  readiness: boolean;
  reconcile: boolean;
  setup: boolean;
  since: boolean;
  test: boolean;
}

const createLookupForeignFlags = (): LookupForeignFlags => ({
  adopt: false,
  change: false,
  hookContext: false,
  hookPrint: false,
  isolated: false,
  jsonl: false,
  newSource: false,
  readiness: false,
  reconcile: false,
  setup: false,
  since: false,
  test: false,
});

const readLookupForeignOption = (
  reader: CliArgReader,
  option: CliOptionToken,
  flags: LookupForeignFlags
): boolean => {
  switch (option.flag) {
    case "--runner":
      readHookRunner(reader.readRequiredOptionValue(option));
      flags.hookPrint = true;
      return true;
    case "--target":
      readTargetName(reader.readRequiredOptionValue(option));
      flags.hookPrint = true;
      return true;
    case "--agent-runtime":
    case "--pre-commit":
    case "--pre-push":
      assertBooleanOption(option);
      flags.hookPrint = true;
      return true;
    case "--event":
      reader.readRequiredOptionValue(option);
      flags.hookContext = true;
      return true;
    case "--format":
      readHookRuntimeContextFormat(reader.readRequiredOptionValue(option));
      flags.hookContext = true;
      return true;
    case "--context-fields": {
      const fields = tokenizeCsv(reader.readRequiredOptionValue(option));
      if (fields.length === 0) {
        throw new Error(
          "skillset: --context-fields requires at least one field"
        );
      }
      fields.map(readHookRuntimeContextField);
      flags.hookContext = true;
      return true;
    }
    case "--prompt":
    case "--prompt-file":
    case "--plugin":
      reader.readRequiredOptionValue(option);
      flags.test = true;
      return true;
    case "--claude-setting-sources":
      readClaudeSettingSources(
        reader.readRequiredOptionValue(option),
        "--claude-setting-sources"
      );
      flags.test = true;
      return true;
    case "--timeout-ms":
    case "--lines":
      readPositiveInteger(reader.readRequiredOptionValue(option), option.flag);
      flags.test = true;
      return true;
    case "--background":
      assertBooleanOption(option);
      flags.test = true;
      return true;
    case "--jsonl":
      assertBooleanOption(option);
      flags.jsonl = true;
      return true;
    case "--append":
    case "--staged":
      assertBooleanOption(option);
      flags.change = true;
      return true;
    case "--bump":
      readChangeBump(reader.readRequiredOptionValue(option));
      flags.change = true;
      return true;
    case "--group":
    case "--ref":
      reader.readRequiredOptionValue(option);
      flags.change = true;
      return true;
    case "--reason": {
      const value = reader.readRequiredOptionValue(option);
      flags.changeReason = setChangeReason(
        flags.changeReason,
        value === "-" ? { kind: "stdin" } : { kind: "inline", value }
      );
      flags.change = true;
      return true;
    }
    case "--reason-file":
      flags.changeReason = setChangeReason(flags.changeReason, {
        kind: "file",
        path: reader.readRequiredOptionValue(option),
      });
      flags.change = true;
      return true;
    case "--targets":
      readTargetNames(reader.readRequiredOptionValue(option));
      flags.setup = true;
      return true;
    case "--include": {
      const includes = tokenizeCsv(reader.readRequiredOptionValue(option));
      if (includes.length === 0) {
        throw new Error("skillset: --include requires at least one value");
      }
      if (includes.some((include) => include !== "ci")) {
        throw new Error("skillset: expected --include ci");
      }
      flags.setup = true;
      return true;
    }
    case "--adopt":
      reader.readRequiredOptionValue(option);
      flags.adopt = true;
      return true;
    case "--fix":
    case "--ci":
      assertBooleanOption(option);
      flags.readiness = true;
      return true;
    case "--only": {
      const value = reader.readRequiredOptionValue(option);
      if (value !== "outputs") {
        throw new Error("skillset: expected --only outputs");
      }
      flags.readiness = true;
      return true;
    }
    case "--report":
      reader.readRequiredOptionValue(option);
      flags.readiness = true;
      return true;
    case "--since":
      reader.readRequiredOptionValue(option);
      flags.since = true;
      return true;
    case "--write":
      assertBooleanOption(option);
      throw new Error("skillset: --write is only supported with check or dev");
    case "--isolated":
      assertBooleanOption(option);
      flags.isolated = true;
      return true;
    case "--use": {
      const value = reader.readRequiredOptionValue(option);
      if (value !== "source" && value !== "output") {
        throw new Error("skillset: --use expects source or output");
      }
      flags.reconcile = true;
      return true;
    }
    case "--id":
    case "--in":
    case "--preset":
      reader.readRequiredOptionValue(option);
      flags.newSource = true;
      return true;
    default:
      return false;
  }
};

const validateLookupForeignFlags = (flags: LookupForeignFlags): void => {
  if (flags.change) {
    throw new Error(
      "skillset: change options are only supported with change commands"
    );
  }
  if (flags.hookPrint) {
    throw new Error(
      "skillset: hook options are only supported with hooks print"
    );
  }
  if (flags.hookContext) {
    throw new Error(
      "skillset: hook context options are only supported with hooks context"
    );
  }
  if (flags.setup) {
    throw new Error("skillset: setup options are only supported with init");
  }
  if (flags.adopt) {
    throw new Error("skillset: --adopt is only supported with init");
  }
  if (flags.readiness) {
    throw new Error("skillset: readiness flags are only supported with check");
  }
  if (flags.since) {
    throw new Error(
      "skillset: --since is only supported with check --ci or change commands"
    );
  }
  if (flags.test) {
    throw new Error(
      "skillset: ad hoc test options are only supported with test"
    );
  }
  if (flags.jsonl) {
    throw new Error("skillset: unknown option --jsonl");
  }
};

const validateLookupLateFlags = (flags: LookupForeignFlags): void => {
  if (flags.isolated) {
    throw new Error(
      "skillset: --isolated is only supported with build, check --only outputs, or diff"
    );
  }
  if (flags.reconcile) {
    throw new Error("skillset: --use is only supported with reconcile");
  }
  if (flags.newSource) {
    throw new Error("skillset: new options are only supported with new");
  }
};

const readHookRunner = (value: string): void => {
  if (
    value !== "git" &&
    value !== "husky" &&
    value !== "lefthook" &&
    value !== "pre-commit"
  ) {
    throw new Error(
      "skillset: expected --runner lefthook, husky, pre-commit, or git"
    );
  }
};
