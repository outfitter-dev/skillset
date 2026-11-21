import { TARGET_NAMES } from "@skillset/schema";

import type { CapabilityComparison } from "../../packages/core/src/capability-crosswalk";
import {
  compareCapability,
  listCapabilities,
} from "../../packages/core/src/capability-crosswalk";
import { compareStrings } from "../../packages/core/src/path";

export const CAPABILITY_REFERENCE_PATH =
  ".skillset/plugins/skillset/skills/skillset-provider-capabilities/references/provider-capabilities.md";
export const CAPABILITY_REFERENCE_HEADER =
  "<!-- Generated capability comparison; do not edit directly. -->";

const codeList = (items: readonly string[]): string =>
  items.length === 0
    ? "none recorded"
    : items.map((item) => `\`${item}\``).join(", ");

const renderComparison = (row: CapabilityComparison): readonly string[] => {
  const { canonical, destination, realization } = row;
  return [
    `### ${row.target}: ${row.featureId}`,
    "",
    `- Skillset source: \`${canonical.shape}\`. Contracts: ${codeList(canonical.contracts)}.`,
    `- Destination: ${destination === undefined ? "none recorded" : `[${destination.id}](#${destination.id})`}. Support: \`${realization.destinationSupport}\`.`,
    `- Realization: ${realization.description}`,
    `- Fidelity: **${row.fidelity}**. Scope: ${row.semanticScope ?? "No current reviewed semantic scope."}`,
    `- Authority: \`${row.authorityHash}\`. Standards: ${codeList(row.standards)}.`,
    ...row.limitations.map((limitation) => `- Limitation: ${limitation}`),
    "",
  ];
};

export const renderCapabilityReference = (): string => {
  const catalog = listCapabilities().map((definition) => ({
    definition,
    rows: compareCapability(definition, TARGET_NAMES),
  }));
  const destinations = new Map(
    catalog.flatMap(({ rows }) =>
      rows.flatMap(({ destination }) =>
        destination === undefined
          ? []
          : [[destination.id, destination] as const]
      )
    )
  );

  return [
    CAPABILITY_REFERENCE_HEADER,
    "",
    "# Provider Capability Comparison Snapshot",
    "",
    "Generated from the same crosswalk as `skillset lookup capability`. Read the matching concept and target rows, plus their destination formats when needed. Exact aliases can match more than one concept.",
    "",
    "Authority pins identify bundled evidence, not its freshness against the live provider. Destination support and fidelity do not establish installation, activation, enforcement, or runtime effectiveness.",
    "",
    ...catalog.flatMap(({ definition, rows }) => [
      `## ${definition.id}`,
      "",
      `${definition.title}. Family: ${definition.family}. Exact aliases: ${codeList(definition.aliases)}.`,
      "",
      ...rows.flatMap(renderComparison),
    ]),
    "## Provider Destination Formats",
    "",
    ...[...destinations.values()]
      .toSorted((left, right) => compareStrings(left.id, right.id))
      .flatMap((destination) => [
        `### ${destination.id}`,
        "",
        destination.title,
        "",
        "```json",
        JSON.stringify(destination.format, null, 2),
        "```",
        "",
        ...destination.provenance.sources.map(
          ({ url }) => `- Source: <${url}>`
        ),
        "",
      ]),
  ].join("\n");
};
