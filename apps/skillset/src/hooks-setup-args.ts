import { getGeneratedEditHookProtocol } from "@skillset/registry";
import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import { resolveCliRoot, type CliParseContext } from "./cli-arg-values";
import { CliUsageError } from "./cli-output";

export interface HooksSetupRequest {
  readonly hookSubcommand: "setup";
  readonly target: string;
  readonly scope: "project" | "user";
  readonly policy: "block" | "warn";
  readonly rootPath: string;
  readonly remove: boolean;
  readonly yes: boolean;
  readonly jsonOutput: boolean;
}

export function parseHooksSetupRequest(args: readonly string[], context: CliParseContext): HooksSetupRequest {
  const reader = new CliArgReader(args, 2);
  let target: string | undefined;
  let scope: HooksSetupRequest["scope"] | undefined;
  let policy: HooksSetupRequest["policy"] = "block";
  let rootPath: string | undefined;
  let remove = false;
  let yes = false;
  let jsonOutput = false;
  while (!reader.done) {
    const option = reader.readOption()!;
    switch (option.flag) {
      case "--target": target = reader.readRequiredOptionValue(option); break;
      case "--scope": {
        const value = reader.readRequiredOptionValue(option);
        if (value !== "project" && value !== "user") throw new CliUsageError("skillset: hooks setup --scope expects project or user");
        scope = value; break;
      }
      case "--policy": {
        const value = reader.readRequiredOptionValue(option);
        if (value !== "block" && value !== "warn") throw new CliUsageError("skillset: --policy expects block or warn");
        policy = value; break;
      }
      case "--root": rootPath = reader.readRequiredOptionValue(option); break;
      case "--remove": assertBooleanOption(option); remove = true; break;
      case "--yes": assertBooleanOption(option); yes = true; break;
      case "--json": assertBooleanOption(option); jsonOutput = true; break;
      default: throw new CliUsageError(`skillset: unknown option ${option.raw}`);
    }
  }
  if (target === undefined || getGeneratedEditHookProtocol(target) === undefined) throw new CliUsageError("skillset: hooks setup requires a documented --target (claude or codex)");
  if (scope === undefined) throw new CliUsageError("skillset: hooks setup requires --scope project or user");
  if (scope === "user" && rootPath !== undefined) throw new CliUsageError("skillset: --root is only supported for project hook setup");
  return { hookSubcommand: "setup", target, scope, policy, rootPath: resolveCliRoot(context, rootPath), remove, yes, jsonOutput };
}
