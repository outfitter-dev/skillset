import { CLI_COMMANDS, type CliCommand } from "./cli-commands";
import { CLI_FLAGS, CLI_ROUTE_FLAGS, type CliFlag } from "./cli-contract";

export const CLI_PRESENTATION_GROUPS = [
  "Author",
  "Build",
  "Inspect",
  "Changes",
  "Distribute",
  "Integrate",
] as const;

export type CliPresentationGroup = (typeof CLI_PRESENTATION_GROUPS)[number];
export type CliPublicRoute = keyof typeof CLI_ROUTE_FLAGS;

interface CliRoutePresentationSource {
  readonly commandSummary?: string;
  readonly examples?: readonly string[];
  readonly group: CliPresentationGroup;
  readonly summary: string;
  readonly synopses: readonly string[];
}

export interface CliRoutePresentation extends CliRoutePresentationSource {
  readonly command: CliCommand;
  readonly flags: readonly CliFlag[];
  readonly route: CliPublicRoute;
}

const PRESENTATION = {
  build: {
    group: "Build",
    summary: "Preview or write generated provider outputs.",
    synopses: [
      "build [--yes] [--updated|--all] [--isolated] [--scope <scope>] [--json] [--root <path>]",
    ],
    examples: ["skillset build", "skillset build --yes"],
  },
  "change add": {
    commandSummary: "Record and inspect source changes before release.",
    group: "Changes",
    summary: "Add a pending source change.",
    synopses: [
      "change add --scope <source-unit> --bump <bump> [--group <group>] [--reason <text>|--reason-file <path>|--reason -] [--since <ref>] [--json] [--root <path>]",
    ],
  },
  "change amend": {
    group: "Changes",
    summary: "Amend a pending change record.",
    synopses: [
      "change amend <@ref> [--ref <ref>] [--reason <text>|--reason-file <path>|--reason -] [--json] [--root <path>]",
    ],
  },
  "change check": {
    group: "Changes",
    summary: "Check source changes against the ledger.",
    synopses: [
      "change check [@ref|--ref <ref>] [--since <ref>] [--staged] [--json] [--root <path>]",
    ],
  },
  "change history": {
    group: "Changes",
    summary: "Show applied change history.",
    synopses: ["change history [@ref] [--ref <ref>] [--json] [--root <path>]"],
  },
  "change ignore": {
    group: "Changes",
    summary: "Record an intentional pending-change ignore.",
    synopses: ["change ignore <@ref> [--ref <ref>] [--yes] [--json] [--root <path>]"],
  },
  "change list": {
    group: "Changes",
    summary: "List pending changes.",
    synopses: ["change list [--group <group>] [--json] [--root <path>]"],
  },
  "change migrate": {
    group: "Changes",
    summary: "Migrate legacy change records.",
    synopses: ["change migrate [--yes] [--json] [--root <path>]"],
  },
  "change reason": {
    group: "Changes",
    summary: "Update a pending change reason.",
    synopses: [
      "change reason <@ref> [--ref <ref>] [--append] [--reason <text>|--reason-file <path>|--reason -] [--json] [--root <path>]",
    ],
  },
  "change refresh": {
    group: "Changes",
    summary: "Refresh stale or missing pending change evidence.",
    synopses: ["change refresh [@ref] [--ref <ref>] [--since <ref>] [--yes] [--json] [--root <path>]"],
  },
  "change show": {
    group: "Changes",
    summary: "Show one pending change.",
    synopses: ["change show <@ref> [--ref <ref>] [--json] [--root <path>]"],
  },
  "change status": {
    group: "Changes",
    summary: "Summarize pending source changes.",
    synopses: [
      "change status [--since <ref>] [--staged] [--json] [--root <path>]",
    ],
  },
  check: {
    group: "Build",
    summary: "Validate source, generated outputs, and CI readiness.",
    synopses: [
      "check [--write|--only outputs|--ci [--fix] [--since <ref>] [--report <path>]] [--json] [--root <path>]",
    ],
    examples: ["skillset check", "skillset check --ci"],
  },
  dev: {
    group: "Build",
    summary: "Watch source and continuously preview or write changes.",
    synopses: ["dev [--write] [--jsonl] [--root <path>]"],
  },
  diff: {
    group: "Build",
    summary: "Show the generated-output plan without writing it.",
    synopses: [
      "diff [--updated|--all] [--isolated] [--scope <scope>] [--json] [--root <path>]",
    ],
  },
  "distribute plan": {
    commandSummary: "Plan distribution-ready plugin artifacts.",
    group: "Distribute",
    summary: "Plan one plugin distribution.",
    synopses: ["distribute plan [name] [--json] [--root <path>]"],
  },
  explain: {
    group: "Inspect",
    summary: "Explain ownership and provenance for a path.",
    synopses: ["explain <path> [--json] [--scope <scope>] [--root <path>]"],
  },
  "hooks context": {
    commandSummary: "Print and run explicit hook integrations.",
    group: "Integrate",
    summary: "Normalize provider hook context.",
    synopses: [
      "hooks context --event <event> [--format env|json] [--context-fields <field,...>] [--root <path>]",
    ],
  },
  "hooks print": {
    group: "Integrate",
    summary: "Print hook runner or agent-runtime configuration.",
    synopses: [
      "hooks print --runner <lefthook|husky|pre-commit|git> [--pre-commit] [--pre-push]",
      "hooks print --target <claude|codex> --agent-runtime",
    ],
  },
  "hooks run": {
    group: "Integrate",
    summary: "Run an explicit normalized hook event.",
    synopses: ["hooks run <post-tool-use|stop> [--root <path>]"],
  },
  import: {
    group: "Author",
    summary: "Import provider-native skills or plugins into source.",
    synopses: [
      "import <path> [--kind <skill|skills|plugin|plugins>] [--from <provider>] [--name <name>] [--json] [--root <path>]",
      "import <claude|codex|cursor|agents> [--json] [--root <path>]",
    ],
  },
  create: {
    group: "Author",
    summary: "Create a named Skillset repository.",
    synopses: [
      "create [name] [--root <parent-directory>] [--yes] [--targets claude,codex,cursor] [--include ci] [--json]",
    ],
    examples: ["skillset create", "skillset create team-loadout --yes"],
  },
  init: {
    group: "Author",
    summary: "Initialize Skillset in an existing directory.",
    synopses: [
      "init [directory] [--adopt <all|candidate-id>] [--yes] [--targets claude,codex,cursor] [--include ci] [--json] [--root <path>]",
    ],
    examples: ["skillset init", "skillset init ../existing-repo"],
  },
  list: {
    group: "Inspect",
    summary: "List authored units and their generated outputs.",
    synopses: ["list [--details] [--json] [--scope <scope>] [--root <path>]"],
  },
  lookup: {
    examples: [
      "skillset lookup",
      "skillset lookup workspace --field compile.targets --values",
      "skillset lookup hooks --events --compat codex",
    ],
    group: "Inspect",
    summary: "Look up schema, compatibility, and provider facts.",
    synopses: [
      "lookup [subject] [aspect...] [--frontmatter] [--fields] [--field <path>] [--values] [--events] [--compat [claude|codex|cursor...]] [--examples] [--schema] [--json]",
    ],
  },
  "lookup features": {
    group: "Inspect",
    summary: "List compiler feature capabilities.",
    synopses: ["lookup features [feature-id] [--json]"],
  },
  "marketplace check": {
    commandSummary: "Check and update curated plugin marketplaces.",
    group: "Distribute",
    summary: "Check marketplace readiness and lock state.",
    synopses: ["marketplace check [name] [--json] [--root <path>]"],
  },
  "marketplace update": {
    group: "Distribute",
    summary: "Update resolved marketplace artifacts.",
    synopses: ["marketplace update [name] [--yes] [--json] [--root <path>]"],
  },
  new: {
    group: "Author",
    summary: "Create a new skill, agent, instruction, or hook in source.",
    synopses: [
      "new [skill|agent|instruction|hook] [name] [--id <id>] [--name <name>] [--in <container>] [--scope repo] [--preset <preset>] [--event <event>] [--command <command> | --script <path>] [--attach <source-unit>] [--provider <provider>] [--yes] [--json] [--root <path>]",
    ],
  },
  reconcile: {
    examples: [
      "skillset reconcile",
      "skillset reconcile .claude/skills/demo/SKILL.md --use output",
    ],
    group: "Changes",
    summary: "Reconcile a managed source/output conflict.",
    synopses: [
      "reconcile [managed-path] [--use <source|output>] [--yes] [--json] [--root <path>]",
    ],
  },
  "release amend": {
    commandSummary: "Audit, plan, apply, and amend releases.",
    group: "Changes",
    summary: "Amend applied release history.",
    synopses: [
      "release amend <@ref> [--ref <ref>] [--reason <text>|--reason-file <path>|--reason -] [--json] [--root <path>]",
    ],
  },
  "release apply": {
    group: "Changes",
    summary: "Apply a planned release.",
    synopses: ["release apply [--yes] [--json] [--root <path>]"],
  },
  "release audit": {
    group: "Changes",
    summary: "Audit release and changelog state.",
    synopses: ["release audit [--json] [--root <path>]"],
  },
  "release plan": {
    group: "Changes",
    summary: "Plan versions and changelog updates.",
    synopses: ["release plan [--json] [--root <path>]"],
  },
  restore: {
    group: "Changes",
    summary: "Restore a recorded generated-output backup.",
    synopses: [
      "restore <backup-id> [--yes] [--json] [--root <path>]",
      "restore --list [--json] [--root <path>]",
    ],
  },
  status: {
    group: "Inspect",
    summary: "Summarize workspace health and generated drift.",
    synopses: ["status [--json] [--root <path>]"],
  },
  test: {
    group: "Inspect",
    summary: "Run declared or ad hoc provider runtime tests.",
    synopses: [
      "test [name] [--json] [--root <path>]",
      "test --target <claude|codex|cursor> [--prompt <text>|--prompt-file <path>] [--plugin <id>] [--name <name>] [--timeout-ms <ms>] [--claude-setting-sources <isolated|user|project|local>] [--background] [--json] [--root <path>]",
    ],
  },
  "test list": {
    group: "Inspect",
    summary: "List retained runtime test runs.",
    synopses: ["test list [--json] [--root <path>]"],
  },
  "test status": {
    group: "Inspect",
    summary: "Show runtime test progress and result state.",
    synopses: ["test status [run-id] [--json] [--root <path>]"],
  },
  "test tail": {
    group: "Inspect",
    summary: "Tail retained runtime test output.",
    synopses: ["test tail [run-id] [--lines <count>] [--json] [--root <path>]"],
  },
  update: {
    group: "Build",
    summary: "Update provider-format snapshots and generated outputs.",
    synopses: ["update [--yes] [--json] [--root <path>]"],
  },
} as const satisfies Record<CliPublicRoute, CliRoutePresentationSource>;

export const CLI_PRESENTATION_CATALOG: readonly CliRoutePresentation[] =
  Object.entries(PRESENTATION).map(([rawRoute, presentation]) => {
    const route = rawRoute as CliPublicRoute;
    const command = route.split(" ", 1)[0] as CliCommand;
    return {
      ...presentation,
      command,
      flags: CLI_ROUTE_FLAGS[route],
      route,
    };
  });

export function routePresentation(
  route: string
): CliRoutePresentation | undefined {
  return CLI_PRESENTATION_CATALOG.find((entry) => entry.route === route);
}

export function commandPresentations(
  command: CliCommand
): readonly CliRoutePresentation[] {
  return CLI_PRESENTATION_CATALOG.filter((entry) => entry.command === command);
}

export function commandPresentation(command: CliCommand): {
  readonly group: CliPresentationGroup;
  readonly summary: string;
} {
  const routes = commandPresentations(command);
  const first = routes[0];
  if (first === undefined) {
    throw new Error(`skillset: command ${command} has no presentation`);
  }
  return {
    group: first.group,
    summary: first.commandSummary ?? first.summary,
  };
}

export function allCommandPresentations(): readonly {
  readonly command: CliCommand;
  readonly group: CliPresentationGroup;
  readonly summary: string;
}[] {
  return CLI_COMMANDS.map((command) => ({
    command,
    ...commandPresentation(command),
  }));
}

export function flagPresentation(flag: CliFlag): {
  readonly meaning: string;
  readonly syntax: string;
} {
  const contract = CLI_FLAGS[flag];
  const suffix =
    contract.value === "boolean"
      ? ""
      : contract.value === "optional-value"
        ? " [value...]"
        : contract.value === "repeatable-value"
          ? " <value>..."
          : " <value>";
  return { meaning: contract.meaning, syntax: `${flag}${suffix}` };
}
