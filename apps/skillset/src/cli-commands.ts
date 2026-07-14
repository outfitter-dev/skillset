export const CLI_COMMANDS = [
  "build", "change", "check", "dev", "diff",
  "distribute", "doctor", "explain", "features", "hooks", "import", "init",
  "list", "lookup", "marketplace", "new", "providers", "release",
  "restore", "suggest-source", "test", "try", "update",
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

export const CLI_LEAF_SUBCOMMANDS: Readonly<Partial<Record<CliCommand, readonly string[]>>> = {
  change: ["add", "amend", "check", "history", "list", "migrate", "reason", "show", "status"],
  distribute: ["plan"],
  hooks: ["context", "print", "run"],
  lookup: ["features"],
  marketplace: ["check", "update"],
  providers: ["check", "diff", "update"],
  release: ["amend", "apply", "audit", "plan"],
  try: ["list", "status", "tail", "worker"],
};

const CLI_COMMAND_SET = new Set<string>(CLI_COMMANDS);

export function isCliCommand(value: string | undefined): value is CliCommand {
  return value !== undefined && CLI_COMMAND_SET.has(value);
}

export function renderExpectedCliCommands(): string {
  const last = CLI_COMMANDS.at(-1);
  return `${CLI_COMMANDS.slice(0, -1).join(", ")}, or ${last}`;
}
