import { isCliCommand, type CliCommand } from "./cli-commands";
import { readCliCommand } from "./cli-output";
import {
  allCommandPresentations,
  CLI_PRESENTATION_CATALOG,
  CLI_PRESENTATION_GROUPS,
  commandPresentation,
  commandPresentations,
  flagPresentation,
  routePresentation,
  type CliPresentationGroup,
  type CliRoutePresentation,
} from "./cli-presentation";
import {
  createTerminalRenderer,
  renderDefinitionList,
  type TerminalRenderOptions,
  type TerminalRenderer,
} from "./terminal-renderer";

export function renderCliHelp(
  args: readonly string[],
  options: TerminalRenderOptions = {}
): string {
  const renderer = createTerminalRenderer(options);
  const request = readHelpRequest(args);
  if (request.kind === "all") return renderAllHelp(renderer);
  if (request.kind === "root") return renderRootHelp(renderer);
  if (request.kind === "command")
    return renderCommandHelp(renderer, request.command);
  return renderRouteHelp(renderer, request.route);
}

type HelpRequest =
  | { readonly kind: "all" }
  | { readonly kind: "command"; readonly command: CliCommand }
  | { readonly kind: "root" }
  | { readonly kind: "route"; readonly route: CliRoutePresentation };

function readHelpRequest(args: readonly string[]): HelpRequest {
  const helpIndex = args.findIndex((arg) => arg === "--help" || arg === "-h");
  const beforeHelp = helpIndex === -1 ? args : args.slice(0, helpIndex);
  const routeName = readCliCommand(beforeHelp);
  if (routeName === "cli") {
    return args.includes("--all") ? { kind: "all" } : { kind: "root" };
  }
  const route = routePresentation(routeName);
  if (route !== undefined) return { kind: "route", route };
  if (isCliCommand(routeName)) return { command: routeName, kind: "command" };
  return { kind: "root" };
}

function renderRootHelp(renderer: TerminalRenderer): string {
  const commands = allCommandPresentations();
  const sections = CLI_PRESENTATION_GROUPS.flatMap((group) => {
    const grouped = commands.filter((entry) => entry.group === group);
    if (grouped.length === 0) return [];
    return [
      `${renderer.bold(group)}\n${renderDefinitionList(
        renderer,
        grouped.map((entry) => ({
          label: renderer.accent(entry.command),
          value: entry.summary,
        }))
      )}`,
    ];
  });
  return [
    renderer.bold("Skillset"),
    renderer.wrap("Source-first compiler for provider-native agent loadouts."),
    "",
    renderer.bold("Usage"),
    "  skillset <command> [options]",
    "",
    ...joinSections(sections),
    "",
    renderer.dim(
      renderer.wrap(
        "Run `skillset <command> --help` for focused help or `skillset --help --all` for every route."
      )
    ),
  ].join("\n");
}

function renderCommandHelp(
  renderer: TerminalRenderer,
  command: CliCommand
): string {
  const presentation = commandPresentation(command);
  const routes = commandPresentations(command);
  return [
    renderer.bold(`skillset ${command}`),
    renderer.wrap(presentation.summary),
    "",
    renderer.bold("Usage"),
    `  skillset ${command} <command> [options]`,
    "",
    renderer.bold("Commands"),
    renderDefinitionList(
      renderer,
      routes.map((entry) => ({
        label: renderer.accent(entry.route.slice(command.length + 1)),
        value: entry.summary,
      }))
    ),
    "",
    renderer.dim(
      `Run \`skillset ${command} <command> --help\` for route options.`
    ),
  ].join("\n");
}

function renderRouteHelp(
  renderer: TerminalRenderer,
  route: CliRoutePresentation
): string {
  const options = route.flags.map((flag) => {
    const presentation = flagPresentation(flag);
    return {
      label: renderer.accent(presentation.syntax),
      value: presentation.meaning,
    };
  });
  const sections = [
    renderer.bold(`skillset ${route.route}`),
    renderer.wrap(route.summary),
    "",
    renderer.bold("Usage"),
    ...route.synopses.map((synopsis) =>
      renderer.wrap(`skillset ${synopsis}`, 2)
    ),
  ];
  if (options.length > 0) {
    sections.push(
      "",
      renderer.bold("Options"),
      renderDefinitionList(renderer, options)
    );
  }
  if (route.examples !== undefined) {
    sections.push(
      "",
      renderer.bold("Examples"),
      ...route.examples.map((example) => `  ${example}`)
    );
  }
  return sections.join("\n");
}

function renderAllHelp(renderer: TerminalRenderer): string {
  const byGroup = new Map<CliPresentationGroup, CliRoutePresentation[]>();
  for (const route of CLI_PRESENTATION_CATALOG) {
    const routes = byGroup.get(route.group) ?? [];
    routes.push(route);
    byGroup.set(route.group, routes);
  }
  const sections = CLI_PRESENTATION_GROUPS.flatMap((group) => {
    const routes = byGroup.get(group);
    if (routes === undefined) return [];
    return [
      [
        renderer.bold(group),
        ...routes.flatMap((route) => [
          ...route.synopses.map((synopsis) =>
            renderer.wrap(`skillset ${synopsis}`, 2)
          ),
          renderer.wrap(route.summary, 4),
        ]),
      ].join("\n"),
    ];
  });
  return [
    renderer.bold("Skillset command reference"),
    renderer.wrap(
      "Every public route and option. Use focused help for option descriptions."
    ),
    "",
    ...joinSections(sections),
  ].join("\n");
}

function joinSections(sections: readonly string[]): readonly string[] {
  return sections.flatMap((section, index) =>
    index === 0 ? [section] : ["", section]
  );
}
