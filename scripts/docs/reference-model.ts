import {
  CLI_COMMANDS,
  type CliCommand,
} from "../../apps/skillset/src/cli-commands";
import {
  CLI_ENVIRONMENT,
  CLI_FLAGS,
  HIDDEN_CLI_ROUTES,
  type CliFlag,
} from "../../apps/skillset/src/cli-contract";
import {
  CLI_PRESENTATION_CATALOG,
  flagPresentation,
  type CliPresentationGroup,
} from "../../apps/skillset/src/cli-presentation";
import {
  listSkillsetFeatures,
  targetDescriptor,
  targetNames,
  type SkillsetFeatureEntry,
  type SkillsetFeatureKind,
  type SkillsetFeatureStatus,
  type SkillsetTargetSupportStatus,
} from "../../packages/core/src";
import {
  listProviderValidationLanes,
  type ProviderValidationLane,
} from "../../packages/registry/src/provider-validation";

type ReferenceTargetName = ReturnType<typeof targetNames>[number];

export interface CliFlagReference {
  readonly family: (typeof CLI_FLAGS)[CliFlag]["family"];
  readonly meaning: string;
  readonly name: CliFlag;
  readonly syntax: string;
  readonly value: (typeof CLI_FLAGS)[CliFlag]["value"];
}

export interface CliEnvironmentReference {
  readonly meaning: string;
  readonly name: keyof typeof CLI_ENVIRONMENT;
}

export interface CliRouteReference {
  readonly examples: readonly string[];
  readonly flags: readonly CliFlagReference[];
  readonly route: string;
  readonly summary: string;
  readonly synopses: readonly string[];
}

export interface CliCommandReference {
  readonly command: CliCommand;
  readonly description: string;
  readonly group: CliPresentationGroup;
  readonly routes: readonly CliRouteReference[];
  readonly summary: string;
}

export interface ReferenceDocLink {
  readonly fragment?: string;
  readonly path: string;
  readonly ref: string;
}

export interface FeatureTargetSupportReference {
  readonly note?: string;
  readonly reason?: string;
  readonly status: SkillsetTargetSupportStatus;
  readonly target: ReferenceTargetName;
}

export interface FeatureSupportReference {
  readonly docs: readonly ReferenceDocLink[];
  readonly id: string;
  readonly kind: SkillsetFeatureKind;
  readonly primaryDoc?: ReferenceDocLink;
  readonly status: SkillsetFeatureStatus;
  readonly summary: string;
  readonly targetSupport: readonly FeatureTargetSupportReference[];
  readonly title: string;
}

export interface SupportReference {
  readonly features: readonly FeatureSupportReference[];
  readonly targets: readonly ReferenceTargetName[];
}

export interface ProviderFeatureReference {
  readonly docs: readonly ReferenceDocLink[];
  readonly featureStatus: SkillsetFeatureStatus;
  readonly id: string;
  readonly note?: string;
  readonly primaryDoc?: ReferenceDocLink;
  readonly reason?: string;
  readonly status: SkillsetTargetSupportStatus;
  readonly title: string;
}

export interface ProviderReference {
  readonly displayLabel: string;
  readonly features: readonly ProviderFeatureReference[];
  readonly id: ReferenceTargetName;
}

export interface DocsReferenceModel {
  readonly cliCommands: readonly CliCommandReference[];
  readonly cliEnvironment: readonly CliEnvironmentReference[];
  readonly cliFlags: readonly CliFlagReference[];
  readonly providers: readonly ProviderReference[];
  readonly providerValidation: readonly ProviderValidationLane[];
  readonly support: SupportReference;
}

export function buildDocsReferenceModel(): DocsReferenceModel {
  const support = buildSupportReference();
  return {
    cliCommands: buildCliCommandReferences(),
    cliEnvironment: buildCliEnvironmentReferences(),
    cliFlags: buildCliFlagReferences(),
    providers: buildProviderReferences(support),
    providerValidation: listProviderValidationLanes(),
    support,
  };
}

export function buildCliFlagReferences(): readonly CliFlagReference[] {
  return (Object.keys(CLI_FLAGS) as CliFlag[]).map(flagReference);
}

export function buildCliEnvironmentReferences(): readonly CliEnvironmentReference[] {
  return (
    Object.entries(CLI_ENVIRONMENT) as [keyof typeof CLI_ENVIRONMENT, string][]
  ).map(([name, meaning]) => ({ meaning, name }));
}

export function buildCliCommandReferences(): readonly CliCommandReference[] {
  const hiddenRoutes = new Set(Object.keys(HIDDEN_CLI_ROUTES));
  return CLI_COMMANDS.map((command) => {
    const sourceRoutes = CLI_PRESENTATION_CATALOG.filter(
      (route) => route.command === command && !hiddenRoutes.has(route.route)
    ).toSorted((left, right) => compareStrings(left.route, right.route));
    const first = sourceRoutes[0];
    if (first === undefined) {
      throw new Error(
        `skillset: CLI command ${command} has no public reference route`
      );
    }
    return {
      command,
      description: commandDescription(
        command,
        first.commandSummary ?? first.summary
      ),
      group: first.group,
      routes: sourceRoutes.map((route) => ({
        examples: [...(route.examples ?? [])],
        flags: route.flags.map(flagReference),
        route: route.route,
        summary: route.summary,
        synopses: [...route.synopses],
      })),
      summary: first.commandSummary ?? first.summary,
    };
  });
}

export function buildSupportReference(
  features: readonly SkillsetFeatureEntry[] = listSkillsetFeatures(),
  targets: readonly ReferenceTargetName[] = targetNames()
): SupportReference {
  const orderedTargets = [...targets];
  return {
    features: [...features]
      .toSorted((left, right) => compareStrings(left.id, right.id))
      .map((feature) => {
        const docs = feature.docs.map(referenceDocLink);
        return {
          docs,
          id: feature.id,
          kind: feature.kind,
          ...(docs[0] === undefined ? {} : { primaryDoc: docs[0] }),
          status: feature.status,
          summary: feature.summary,
          targetSupport: orderedTargets.map((target) => {
            const support = feature.targetSupport[target];
            return {
              ...(support.note === undefined ? {} : { note: support.note }),
              ...(support.reason === undefined
                ? {}
                : { reason: support.reason }),
              status: support.status,
              target,
            };
          }),
          title: feature.title,
        };
      }),
    targets: orderedTargets,
  };
}

export function buildProviderReferences(
  support: SupportReference = buildSupportReference()
): readonly ProviderReference[] {
  return support.targets.map((target) => ({
    displayLabel: targetDescriptor(target).displayLabel,
    features: support.features.map((feature) => {
      const targetSupport = feature.targetSupport.find(
        (candidate) => candidate.target === target
      );
      if (targetSupport === undefined) {
        throw new Error(
          `skillset: feature ${feature.id} has no ${target} provider support reference`
        );
      }
      return {
        docs: feature.docs.map((doc) => ({ ...doc })),
        featureStatus: feature.status,
        id: feature.id,
        ...(targetSupport.note === undefined
          ? {}
          : { note: targetSupport.note }),
        ...(feature.primaryDoc === undefined
          ? {}
          : { primaryDoc: { ...feature.primaryDoc } }),
        ...(targetSupport.reason === undefined
          ? {}
          : { reason: targetSupport.reason }),
        status: targetSupport.status,
        title: feature.title,
      };
    }),
    id: target,
  }));
}

function flagReference(name: CliFlag): CliFlagReference {
  const contract = CLI_FLAGS[name];
  return {
    family: contract.family,
    meaning: contract.meaning,
    name,
    syntax: flagPresentation(name).syntax,
    value: contract.value,
  };
}

function referenceDocLink(ref: string): ReferenceDocLink {
  const hash = ref.indexOf("#");
  if (hash === -1) return { path: ref, ref };
  return {
    fragment: ref.slice(hash + 1),
    path: ref.slice(0, hash),
    ref,
  };
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function commandDescription(command: CliCommand, summary: string): string {
  const behavior = summary.endsWith(".") ? summary.slice(0, -1) : summary;
  return `The Skillset ${command} command can ${behavior.charAt(0).toLowerCase()}${behavior.slice(1)}.`;
}
