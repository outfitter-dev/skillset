import { parseCliRequest } from "../apps/skillset/src/cli-args";
import {
  CLI_COMMANDS,
  CLI_LEAF_SUBCOMMANDS,
} from "../apps/skillset/src/cli-commands";
import type { CliCommand } from "../apps/skillset/src/cli-commands";
import { USAGE } from "../apps/skillset/src/cli-usage";
import {
  CLI_FLAGS,
  CLI_ROUTE_FLAGS,
  FINITE_JSON_ROUTES,
  HIDDEN_CLI_ROUTES,
  JSONL_ROUTES,
  STRUCTURED_OUTPUT_EXCEPTIONS,
} from "./cli-contract";
import type { CliFlag } from "./cli-contract";

export interface CliContractParityViolation {
  readonly surface: "contract" | "help" | "runtime" | "structured-output";
  readonly message: string;
}

export interface CliContractParitySurfaces {
  readonly finiteJsonRoutes?: readonly string[];
  readonly hiddenRouteFlags?: Readonly<Record<string, readonly CliFlag[]>>;
  readonly jsonlRoutes?: readonly string[];
  readonly publicRouteFlags?: Readonly<Record<string, readonly CliFlag[]>>;
  readonly structuredOutputExceptions?: readonly string[];
  readonly usage?: string;
}

export function validateCliContractParity(
  surfaces: CliContractParitySurfaces = {}
): readonly CliContractParityViolation[] {
  const violations: CliContractParityViolation[] = [];
  const publicRouteFlags: Readonly<Record<string, readonly CliFlag[]>> =
    surfaces.publicRouteFlags ?? CLI_ROUTE_FLAGS;
  const hiddenRouteFlags: Readonly<Record<string, readonly CliFlag[]>> =
    surfaces.hiddenRouteFlags ?? HIDDEN_CLI_ROUTES;
  const publicRoutes = Object.keys(publicRouteFlags);
  const hiddenRoutes = Object.keys(hiddenRouteFlags);
  const maintainedRoutes = new Set([...publicRoutes, ...hiddenRoutes]);

  for (const command of CLI_COMMANDS) {
    if (
      ![...maintainedRoutes].some((route) => routeCommand(route) === command)
    ) {
      violations.push({
        surface: "contract",
        message: `top-level command ${command} has no maintained route`,
      });
    }
    for (const leaf of CLI_LEAF_SUBCOMMANDS[command] ?? []) {
      const route = `${command} ${leaf}`;
      if (!maintainedRoutes.has(route)) {
        violations.push({
          surface: "contract",
          message: `runtime leaf route ${route} is absent from the public and hidden contracts`,
        });
      }
    }
  }
  for (const route of maintainedRoutes) {
    const [command, leaf, ...extra] = route.split(" ");
    if (!CLI_COMMANDS.includes(command as CliCommand)) {
      violations.push({
        surface: "contract",
        message: `contract route ${route} uses an unknown top-level command`,
      });
      continue;
    }
    if (extra.length > 0) {
      violations.push({
        surface: "contract",
        message: `contract route ${route} is deeper than the runtime grammar`,
      });
    }
    if (
      leaf !== undefined &&
      !(CLI_LEAF_SUBCOMMANDS[command as CliCommand] ?? []).includes(leaf)
    ) {
      violations.push({
        surface: "contract",
        message: `contract route ${route} is not a runtime leaf route`,
      });
    }
  }

  const helpFlags = readHelpRouteFlags(surfaces.usage ?? USAGE);
  for (const route of publicRoutes) {
    const actual = [...(helpFlags.get(route) ?? [])].toSorted();
    const expected = [...(publicRouteFlags[route] ?? [])].toSorted();
    if (!equalStrings(actual, expected)) {
      violations.push({
        surface: "help",
        message: `${route} flags differ: help=${renderList(actual)} contract=${renderList(expected)}`,
      });
    }
  }
  for (const route of helpFlags.keys()) {
    if (!Object.hasOwn(publicRouteFlags, route)) {
      violations.push({
        surface: "help",
        message: `public help exposes route ${route} outside the maintained contract`,
      });
    }
  }
  for (const route of hiddenRoutes) {
    if (helpFlags.has(route)) {
      violations.push({
        surface: "help",
        message: `hidden route ${route} is exposed in public help`,
      });
    }
  }

  const classifiedRoutes = [
    ...(surfaces.finiteJsonRoutes ?? FINITE_JSON_ROUTES),
    ...(surfaces.jsonlRoutes ?? JSONL_ROUTES),
    ...(
      surfaces.structuredOutputExceptions ?? STRUCTURED_OUTPUT_EXCEPTIONS
    ).map((entry) => entry.split(":", 1)[0] ?? ""),
  ];
  const classificationCounts = new Map<string, number>();
  for (const route of classifiedRoutes) {
    classificationCounts.set(route, (classificationCounts.get(route) ?? 0) + 1);
  }
  for (const route of publicRoutes) {
    const count = classificationCounts.get(route) ?? 0;
    if (count !== 1) {
      violations.push({
        message: `${route} has ${count} machine-output classifications; expected exactly one`,
        surface: "structured-output",
      });
    }
  }
  for (const route of classificationCounts.keys()) {
    if (!Object.hasOwn(publicRouteFlags, route)) {
      violations.push({
        message: `machine-output classification references unknown public route ${route}`,
        surface: "structured-output",
      });
    }
  }

  for (const route of maintainedRoutes) {
    try {
      parseCliRequest(runtimeRouteSeed(route), {
        cwd: "/tmp/skillset-cli-contract-parity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      violations.push({
        message: `${route} is not executable through the parser facade: ${message}`,
        surface: "runtime",
      });
    }
  }

  for (const [route, flags] of [
    ...Object.entries(publicRouteFlags),
    ...Object.entries(hiddenRouteFlags),
  ]) {
    for (const flag of flags) {
      const args = [
        ...runtimeRouteSeed(route, flag as CliFlag),
        ...runtimeFlagArgs(flag as CliFlag, route),
      ];
      try {
        parseCliRequest(args, { cwd: "/tmp/skillset-cli-contract-parity" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        violations.push({
          message: `${route} does not accept declared flag ${flag}: ${message}`,
          surface: "runtime",
        });
      }
    }
  }

  return violations;
}

function readHelpRouteFlags(
  usage: string
): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  for (const line of usage.split("\n")) {
    const marker = "skillset ";
    const markerIndex = line.indexOf(marker);
    if (markerIndex === -1) continue;
    const grammar = line.slice(markerIndex + marker.length);
    const [rawCommand, second] = grammar.split(/\s+/u);
    if (!CLI_COMMANDS.includes(rawCommand as CliCommand)) continue;
    const command = rawCommand as CliCommand;
    const flags = grammar.match(/--[a-z][a-z-]*/gu) ?? [];
    for (const route of helpRoutes(command, second)) {
      const routeFlags = result.get(route) ?? new Set<string>();
      for (const flag of flags) routeFlags.add(flag);
      result.set(route, routeFlags);
    }
  }
  return result;
}

function helpRoutes(
  command: CliCommand,
  second: string | undefined
): readonly string[] {
  const leaves = CLI_LEAF_SUBCOMMANDS[command] ?? [];
  if (second !== undefined && leaves.includes(second)) {
    return [`${command} ${second}`];
  }
  const alternatives = second?.match(/^<([^>]+)>$/u)?.[1]?.split("|") ?? [];
  const matchedLeaves = alternatives.filter((value) => leaves.includes(value));
  return matchedLeaves.length > 0
    ? matchedLeaves.map((leaf) => `${command} ${leaf}`)
    : [command];
}

function runtimeRouteSeed(route: string, flag?: CliFlag): readonly string[] {
  switch (route) {
    case "change add":
      return ["change", "add", "--scope", "plugin:example", "--bump", "patch"];
    case "change amend":
    case "change reason":
    case "change show":
    case "release amend":
      return [...route.split(" "), "@example"];
    case "explain":
      return ["explain", "skill.md"];
    case "hooks context":
      return ["hooks", "context", "--event", "Stop"];
    case "check":
      if (flag === "--fix" || flag === "--report" || flag === "--since") {
        return ["check", "--ci"];
      }
      return ["check"];
    case "hooks print":
      return flag === "--target" || flag === "--agent-runtime"
        ? ["hooks", "print", "--target", "codex", "--agent-runtime"]
        : ["hooks", "print", "--runner", "git"];
    case "hooks run":
      return ["hooks", "run", "stop"];
    case "import":
      return ["import", "source"];
    case "new":
      return ["new", "skill"];
    case "reconcile":
      return flag === "--yes"
        ? ["reconcile", "managed/path", "--use", "source"]
        : ["reconcile", "managed/path"];
    case "restore":
      return ["restore", "backup-id"];
    case "test":
      if (flag !== undefined && flag !== "--json" && flag !== "--root") {
        return flag === "--prompt" || flag === "--prompt-file"
          ? ["test", "--target", "claude"]
          : ["test", "--target", "claude", "--prompt", "Run it"];
      }
      return ["test"];
    case "test worker":
      return ["test", "worker", "run-id"];
    default:
      return route.split(" ");
  }
}

function runtimeFlagArgs(flag: CliFlag, route: string): readonly string[] {
  if (CLI_FLAGS[flag].value === "boolean" || flag === "--compat") {
    return [flag];
  }
  const value = (() => {
    switch (flag) {
      case "--adopt":
        return "all";
      case "--bump":
        return "patch";
      case "--claude-setting-sources":
        return "user";
      case "--context-fields":
        return "provider";
      case "--event":
        return "Stop";
      case "--format":
        return "env";
      case "--from":
        return "claude";
      case "--include":
        return "ci";
      case "--kind":
        return "skill";
      case "--lines":
        return "1";
      case "--only":
        return "outputs";
      case "--preset":
        return "minimal";
      case "--provider":
        return "claude";
      case "--ref":
        return "@example";
      case "--runner":
        return "git";
      case "--scope":
        return route === "new"
          ? "repo"
          : route === "change add"
            ? "plugin:example"
            : "plugins";
      case "--target":
        return "codex";
      case "--targets":
        return "codex";
      case "--timeout-ms":
        return "1000";
      case "--use":
        return "source";
      default:
        return "example";
    }
  })();
  return [flag, value];
}

function routeCommand(route: string): string {
  return route.split(" ", 1)[0] ?? route;
}

function equalStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function renderList(values: readonly string[]): string {
  return values.length === 0 ? "<none>" : values.join(",");
}

if (import.meta.main) {
  const violations = validateCliContractParity();
  if (violations.length === 0) {
    console.error("skillset: CLI contract parity is clean");
  } else {
    console.error(
      `skillset: CLI contract parity found ${violations.length} violation(s):`
    );
    for (const violation of violations) {
      console.error(`  [${violation.surface}] ${violation.message}`);
    }
    process.exit(1);
  }
}
