import type { GeneratedEntry } from "@skillset/core/internal/types";

import {
  createTerminalRenderer,
  renderDefinitionList,
  type TerminalRenderOptions,
} from "./terminal-renderer";

type UnitGroup =
  | "Plugins"
  | "Skills"
  | "Rules"
  | "Provider configuration"
  | "Other outputs";

interface GeneratedUnit {
  readonly entries: readonly GeneratedEntry[];
  readonly group: UnitGroup;
  readonly key: string;
  readonly label: string;
  readonly providers: readonly string[];
}

const GROUP_ORDER: readonly UnitGroup[] = [
  "Plugins",
  "Skills",
  "Rules",
  "Provider configuration",
  "Other outputs",
];

export function renderGeneratedEntryList(
  entries: readonly GeneratedEntry[],
  details: boolean,
  options: TerminalRenderOptions = {}
): string {
  const renderer = createTerminalRenderer(options);
  const units = collectGeneratedUnits(entries);
  const sections = GROUP_ORDER.flatMap((group) => {
    const grouped = units.filter((unit) => unit.group === group);
    if (grouped.length === 0) return [];
    const outputCount = grouped.reduce(
      (total, unit) => total + unit.entries.length,
      0
    );
    const heading = renderer.wrap(
      `${renderer.bold(group)} ${renderer.dim(`(${grouped.length} ${plural("source", grouped.length)}, ${outputCount} ${plural("output", outputCount)})`)}`
    );
    if (details) {
      return [
        [
          heading,
          ...grouped.flatMap((unit) => renderUnitDetails(renderer, unit)),
        ].join("\n"),
      ];
    }
    return [
      `${heading}\n${renderDefinitionList(
        renderer,
        grouped.map((unit) => ({
          label: renderer.accent(unit.label),
          value: renderUnitSummary(unit),
        }))
      )}`,
    ];
  });
  const providers = [
    ...new Set(units.flatMap((unit) => unit.providers)),
  ].toSorted();
  const summary = `${units.length} ${plural("source", units.length)} · ${entries.length} ${plural("output", entries.length)}${providers.length === 0 ? "" : ` · ${providers.join(", ")}`}`;
  return [
    renderer.bold("Skillset workspace"),
    "",
    ...sections.flatMap((section, index) =>
      index === 0 ? [section] : ["", section]
    ),
    "",
    renderer.wrap(`${renderer.bold("Summary")}  ${summary}`),
  ].join("\n");
}

function collectGeneratedUnits(
  entries: readonly GeneratedEntry[]
): readonly GeneratedUnit[] {
  const collected = new Map<
    string,
    { entries: GeneratedEntry[]; group: UnitGroup; label: string }
  >();
  for (const entry of entries) {
    const identity = unitIdentity(entry);
    const existing = collected.get(identity.key);
    if (existing === undefined) {
      collected.set(identity.key, {
        entries: [entry],
        group: identity.group,
        label: identity.label,
      });
    } else {
      existing.entries.push(entry);
    }
  }
  return [...collected.entries()]
    .map(
      ([key, unit]): GeneratedUnit => ({
        ...unit,
        key,
        providers: [
          ...new Set(
            unit.entries
              .map(providerForEntry)
              .filter((value) => value !== undefined)
          ),
        ].toSorted(),
      })
    )
    .toSorted(
      (left, right) =>
        GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group) ||
        left.label.localeCompare(right.label)
    );
}

function unitIdentity(entry: GeneratedEntry): {
  readonly group: UnitGroup;
  readonly key: string;
  readonly label: string;
} {
  const plugin = entry.sourcePath.match(/^\.skillset\/plugins\/([^/]+)/u)?.[1];
  if (plugin !== undefined)
    return { group: "Plugins", key: `plugin:${plugin}`, label: plugin };
  const skill = entry.sourcePath.match(/^\.skillset\/skills\/([^/]+)/u)?.[1];
  if (skill !== undefined)
    return { group: "Skills", key: `skill:${skill}`, label: skill };
  const rule = entry.sourcePath.match(/^\.skillset\/rules(?:\/(.*))?$/u)?.[1];
  if (entry.sourcePath === ".skillset/rules" || rule !== undefined) {
    const label =
      rule === undefined
        ? "workspace instructions"
        : rule.replace(/\.(md|mdc)$/u, "");
    return { group: "Rules", key: `rule:${label}`, label };
  }
  const provider = entry.sourcePath.match(/^\.skillset\/_([^/]+)/u)?.[1];
  if (provider !== undefined) {
    return {
      group: "Provider configuration",
      key: `provider:${provider}`,
      label: provider,
    };
  }
  return {
    group: "Other outputs",
    key: `other:${entry.sourcePath}`,
    label: entry.feature ?? entry.kind ?? entry.sourcePath,
  };
}

function providerForEntry(entry: GeneratedEntry): string | undefined {
  const output = entry.outputPath;
  if (output.startsWith(".claude/") || output.includes("/claude/"))
    return "claude";
  if (
    output.startsWith(".agents/") ||
    output.startsWith(".codex/") ||
    output.includes("/codex/")
  )
    return "codex";
  if (output.startsWith(".cursor/") || output.includes("/cursor/"))
    return "cursor";
  return entry.target === "workspace" ? undefined : entry.target;
}

function renderUnitSummary(unit: GeneratedUnit): string {
  const destinations =
    unit.providers.length === 0 ? "workspace" : unit.providers.join(", ");
  return `${destinations} · ${unit.entries.length} ${plural("output", unit.entries.length)}`;
}

function renderUnitDetails(
  renderer: ReturnType<typeof createTerminalRenderer>,
  unit: GeneratedUnit
): readonly string[] {
  return [
    `  ${renderer.accent(unit.label)}  ${renderer.dim(renderUnitSummary(unit))}`,
    ...unit.entries.map((entry) => {
      const provider = providerForEntry(entry) ?? "workspace";
      const feature = entry.feature === undefined ? "" : ` ${entry.feature}`;
      const origin = entry.origin === undefined ? "" : ` (${entry.origin})`;
      const dependencies = entry.dependencies?.length
        ? ` · deps: ${entry.dependencies.join(", ")}`
        : "";
      return renderer.wrap(
        `[${provider}] ${entry.kind ?? "generated"}${feature}${origin} ${entry.sourcePath} -> ${entry.outputPath}${dependencies}`,
        4
      );
    }),
  ];
}

function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
