import { describe, expect, test } from "bun:test";

import { CLI_COMMANDS } from "../../../apps/skillset/src/cli-commands";
import {
  CLI_ENVIRONMENT,
  CLI_FLAGS,
  HIDDEN_CLI_ROUTES,
} from "../../../apps/skillset/src/cli-contract";
import { CLI_PRESENTATION_CATALOG } from "../../../apps/skillset/src/cli-presentation";
import {
  listSkillsetFeatures,
  targetNames,
  type SkillsetFeatureEntry,
} from "../../../packages/core/src";
import {
  buildCliCommandReferences,
  buildCliEnvironmentReferences,
  buildCliFlagReferences,
  buildDocsReferenceModel,
  buildSupportReference,
} from "../reference-model";

describe("documentation reference model", () => {
  test("derives one deterministic page for every top-level CLI command", () => {
    const beforeCommands = [...CLI_COMMANDS];
    const beforeCatalog = structuredClone(CLI_PRESENTATION_CATALOG);
    const first = buildCliCommandReferences();
    const second = buildCliCommandReferences();

    expect(first).toEqual(second);
    expect(first[0]?.description).toBe(
      "The Skillset build command can preview or write generated provider outputs."
    );
    expect(first.map((entry) => entry.command)).toEqual([...CLI_COMMANDS]);
    expect(new Set(first.map((entry) => entry.command)).size).toBe(
      CLI_COMMANDS.length
    );
    expect([...CLI_COMMANDS]).toEqual(beforeCommands);
    expect(CLI_PRESENTATION_CATALOG).toEqual(beforeCatalog);
  });

  test("covers every public CLI route and canonical flag exactly", () => {
    const references = buildCliCommandReferences();
    const routes = references.flatMap((command) => command.routes);

    expect(routes.map((route) => route.route).toSorted()).toEqual(
      CLI_PRESENTATION_CATALOG.map((route) => route.route).toSorted()
    );
    expect(new Set(routes.map((route) => route.route)).size).toBe(
      routes.length
    );
    for (const hidden of Object.keys(HIDDEN_CLI_ROUTES)) {
      expect(routes.map((route) => route.route)).not.toContain(hidden);
    }
    for (const route of routes) {
      const source = CLI_PRESENTATION_CATALOG.find(
        (candidate) => candidate.route === route.route
      );
      if (source === undefined)
        throw new Error(`missing source route ${route.route}`);
      expect(route.flags.map((flag) => flag.name)).toEqual([...source.flags]);
      for (const flag of route.flags) {
        expect(flag).toMatchObject({
          family: CLI_FLAGS[flag.name].family,
          meaning: CLI_FLAGS[flag.name].meaning,
          value: CLI_FLAGS[flag.name].value,
        });
      }
    }
  });

  test("preserves the exhaustive CLI flag catalog in canonical exported order", () => {
    const flagsBefore = structuredClone(CLI_FLAGS);
    const first = buildCliFlagReferences();
    const second = buildCliFlagReferences();

    expect(first).toEqual(second);
    expect(first.map((flag) => flag.name).join("\n")).toBe(
      Object.keys(CLI_FLAGS).join("\n")
    );
    expect(new Set(first.map((flag) => flag.name)).size).toBe(
      Object.keys(CLI_FLAGS).length
    );
    for (const flag of first) {
      expect(flag).toMatchObject({
        family: CLI_FLAGS[flag.name].family,
        meaning: CLI_FLAGS[flag.name].meaning,
        value: CLI_FLAGS[flag.name].value,
      });
    }
    expect(CLI_FLAGS).toEqual(flagsBefore);
  });

  test("preserves CLI environment facts in canonical exported order", () => {
    const environmentBefore = structuredClone(CLI_ENVIRONMENT);
    const first = buildCliEnvironmentReferences();
    const second = buildCliEnvironmentReferences();

    expect(first).toEqual(second);
    expect(first.map((entry) => entry.name).join("\n")).toBe(
      Object.keys(CLI_ENVIRONMENT).join("\n")
    );
    expect(new Set(first.map((entry) => entry.name)).size).toBe(
      Object.keys(CLI_ENVIRONMENT).length
    );
    for (const entry of first) {
      expect(entry.meaning).toBe(CLI_ENVIRONMENT[entry.name]);
    }
    expect(CLI_ENVIRONMENT).toEqual(environmentBefore);
  });

  test("derives stable feature and target coverage without mutating registry exports", () => {
    const registry = listSkillsetFeatures();
    const registryBefore = structuredClone(registry);
    const targetsBefore = [...targetNames()];
    const first = buildSupportReference();
    const second = buildSupportReference();

    expect(first).toEqual(second);
    expect(first.targets).toEqual(targetNames());
    expect(first.features.map((feature) => feature.id)).toEqual(
      registry.map((feature) => feature.id).toSorted()
    );
    expect(new Set(first.features.map((feature) => feature.id)).size).toBe(
      registry.length
    );
    for (const feature of first.features) {
      const source = registry.find((candidate) => candidate.id === feature.id);
      if (source === undefined)
        throw new Error(`missing source feature ${feature.id}`);
      expect(feature.targetSupport.map((support) => support.target)).toEqual([
        ...targetNames(),
      ]);
      for (const support of feature.targetSupport) {
        expect(support.status).toBe(
          source.targetSupport[support.target].status
        );
      }
    }
    expect(registry).toEqual(registryBefore);
    expect(targetNames()).toEqual(targetsBefore);
  });

  test("preserves registry documentation references and fragments as link data", () => {
    const source = listSkillsetFeatures()[0];
    if (source === undefined) throw new Error("expected a seeded feature");
    const feature: SkillsetFeatureEntry = {
      ...source,
      docs: [
        "docs/reference/features/demo.md#target-support",
        "docs/reference/features/secondary.md",
      ],
      id: "fragment-proof",
    };

    const support = buildSupportReference([feature]);

    expect(support.features[0]?.docs).toEqual([
      {
        fragment: "target-support",
        path: "docs/reference/features/demo.md",
        ref: "docs/reference/features/demo.md#target-support",
      },
      {
        path: "docs/reference/features/secondary.md",
        ref: "docs/reference/features/secondary.md",
      },
    ]);
    expect(support.features[0]?.primaryDoc).toEqual(
      support.features[0]?.docs[0]
    );
  });

  test("composes the CLI and support projections into one model", () => {
    const model = buildDocsReferenceModel();

    expect(model.cliCommands).toHaveLength(CLI_COMMANDS.length);
    expect(model.cliFlags).toHaveLength(Object.keys(CLI_FLAGS).length);
    expect(model.cliEnvironment).toHaveLength(
      Object.keys(CLI_ENVIRONMENT).length
    );
    expect(model.support.features).toHaveLength(listSkillsetFeatures().length);
    expect(model.support.targets).toEqual(targetNames());
  });
});
