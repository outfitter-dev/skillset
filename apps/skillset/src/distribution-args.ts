import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import {
  mergeBuildMode,
  readBuildScopes,
  resolveCliRoot,
} from "./cli-arg-values";
import type { CliParseContext } from "./cli-arg-values";
import type {
  DistributionCommandRequest,
  MarketplaceCommandRequest,
} from "./distribution-cli";

type DistributionSubcommand = "plan";
type MarketplaceSubcommand = "check" | "update";

export const parseDistributionCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): DistributionCommandRequest => {
  const subcommand = readDistributionSubcommand(args[1]);
  let index = 2;
  let name: string | undefined;
  const positional = args[index];
  if (positional !== undefined && !positional.startsWith("--")) {
    name = positional;
    index += 1;
  }
  const parsed = parseDistributionOptions(args, index, context);
  validateLowercaseId(name, "distribution");
  if (parsed.hasBuildOptions || parsed.yes) {
    throw new Error(
      "skillset: build/write options are not supported with distribute plan; it is always read-only"
    );
  }
  return {
    distributionName: name,
    distributionSubcommand: subcommand,
    jsonOutput: parsed.jsonOutput,
    options: {},
    rootPath: parsed.rootPath,
  };
};

export const parseMarketplaceCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): MarketplaceCommandRequest => {
  const subcommand = readMarketplaceSubcommand(args[1]);
  let index = 2;
  let name: string | undefined;
  const positional = args[index];
  if (positional !== undefined && !positional.startsWith("--")) {
    name = positional;
    index += 1;
  }
  const parsed = parseDistributionOptions(args, index, context);
  validateLowercaseId(name, "marketplace");
  if (subcommand === "check" && parsed.yes) {
    throw new Error(
      "skillset: build/write options are not supported with marketplace check; it is always read-only"
    );
  }
  if (parsed.hasBuildOptions) {
    throw new Error(
      `skillset: build scope options are not supported with marketplace ${subcommand}`
    );
  }
  return {
    jsonOutput: parsed.jsonOutput,
    marketplaceName: name,
    marketplaceSubcommand: subcommand,
    options: {},
    rootPath: parsed.rootPath,
    yes: parsed.yes,
  };
};

interface DistributionOptions {
  readonly hasBuildOptions: boolean;
  readonly jsonOutput: boolean;
  readonly rootPath: string;
  readonly yes: boolean;
}

const parseDistributionOptions = (
  args: readonly string[],
  index: number,
  context: CliParseContext
): DistributionOptions => {
  let buildMode: "all" | "updated" | undefined;
  let jsonOutput = false;
  let rootPath: string | undefined;
  let scopes: readonly unknown[] | undefined;
  let yes = false;
  const reader = new CliArgReader(args, index);
  while (!reader.done) {
    const option = reader.readOption();
    if (option === undefined) break;
    switch (option.flag) {
      case "--root":
        rootPath = reader.readRequiredOptionValue(option);
        break;
      case "--json":
        assertBooleanOption(option);
        jsonOutput = true;
        break;
      case "--yes":
        assertBooleanOption(option);
        yes = true;
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
      case "--name":
      case "--kind":
      case "--from":
        reader.readRequiredOptionValue(option);
        break;
      default:
        throw new Error(`skillset: unknown option ${option.raw}`);
    }
  }
  return {
    hasBuildOptions: buildMode !== undefined || scopes !== undefined,
    jsonOutput,
    rootPath: resolveCliRoot(context, rootPath),
    yes,
  };
};

const readDistributionSubcommand = (
  value: string | undefined
): DistributionSubcommand => {
  if (value === "plan") return value;
  throw new Error("skillset: expected distribute subcommand plan");
};

const readMarketplaceSubcommand = (
  value: string | undefined
): MarketplaceSubcommand => {
  if (value === "check" || value === "update") return value;
  throw new Error("skillset: expected marketplace subcommand check or update");
};

const validateLowercaseId = (
  value: string | undefined,
  kind: "distribution" | "marketplace"
): void => {
  if (value !== undefined && !/^[a-z0-9][a-z0-9._-]*$/.test(value)) {
    throw new Error(`skillset: expected ${kind} name to be a lowercase id`);
  }
};
