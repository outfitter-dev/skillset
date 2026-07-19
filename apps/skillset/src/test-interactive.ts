import type {
  SkillsetOptions,
  TargetName,
} from "@skillset/core/internal/types";
import { TARGET_LIST_TEXT } from "@skillset/core";

import type { InteractiveSession } from "./interactive-session";
import type { PromptChoice } from "./prompt-adapter";
import {
  listAdHocTestTargets,
  listSkillsetTests,
  type SkillsetTestSummary,
} from "./test-runner";

const SEARCH_THRESHOLD = 8;

export interface InteractiveTestRequest {
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export type InteractiveTestSelection =
  | { readonly kind: "all" }
  | { readonly kind: "declared"; readonly name: string }
  | {
      readonly background: boolean;
      readonly kind: "ad-hoc";
      readonly prompt: string;
      readonly target: TargetName;
    };

type TestChoice =
  | { readonly kind: "all" }
  | { readonly kind: "declared"; readonly name: string }
  | { readonly kind: "ad-hoc" };

export async function resolveInteractiveTestSelection(
  request: InteractiveTestRequest,
  session: InteractiveSession
): Promise<InteractiveTestSelection> {
  const declarations = await listSkillsetTests(
    request.rootPath,
    request.options
  );
  const selection = await promptForSelection(declarations, session);
  if (selection.kind === "all") return selection;
  if (selection.kind === "declared") return selection;

  const prompt = await session.prompts.input({ message: "Prompt:" });
  const targets = await listAdHocTestTargets(request.rootPath, request.options);
  const target = await promptForTarget(targets, session);
  const background = await session.prompts.select({
    choices: [
      {
        description: "Wait for the test to finish and show the result",
        name: "Foreground",
        value: false,
      },
      {
        description: "Start the test and return to the shell",
        name: "Background",
        value: true,
      },
    ],
    default: false,
    message: "Run:",
  });
  return { background, kind: "ad-hoc", prompt, target };
}

async function promptForSelection(
  declarations: readonly SkillsetTestSummary[],
  session: InteractiveSession
): Promise<TestChoice> {
  const choices = selectionChoices(declarations);
  const defaultChoice = choices[0]?.value;
  if (defaultChoice === undefined) {
    throw new Error("skillset: interactive test chooser has no actions");
  }
  return declarations.length >= SEARCH_THRESHOLD
    ? session.prompts.search({
        default: defaultChoice,
        message: "Run:",
        source: (term) => filterSelectionChoices(choices, term),
      })
    : session.prompts.select({
        choices,
        default: defaultChoice,
        message: "Run:",
      });
}

function selectionChoices(
  declarations: readonly SkillsetTestSummary[]
): readonly PromptChoice<TestChoice>[] {
  return [
    ...(declarations.length === 0
      ? []
      : [
          {
            description: `Run all ${declarations.length} ${declarations.length === 1 ? "test" : "tests"} declared in this workspace`,
            name: "All tests",
            value: { kind: "all" } as const,
          },
        ]),
    ...declarations.map((declaration) => ({
      description: `Targets: ${declaration.targets.join(", ")}`,
      name: declaration.name,
      value: { kind: "declared", name: declaration.name } as const,
    })),
    {
      description: "Run a prompt against one target without saving a test",
      name: "Ad hoc test",
      value: { kind: "ad-hoc" } as const,
    },
  ];
}

function filterSelectionChoices(
  choices: readonly PromptChoice<TestChoice>[],
  term: string | undefined
): readonly PromptChoice<TestChoice>[] {
  const query = term?.trim().toLowerCase() ?? "";
  if (query.length === 0) return choices;
  return choices.filter(
    (choice) =>
      choice.value.kind !== "declared" ||
      choice.name.toLowerCase().includes(query) ||
      choice.description?.toLowerCase().includes(query)
  );
}

async function promptForTarget(
  targets: readonly TargetName[],
  session: InteractiveSession
): Promise<TargetName> {
  const first = targets[0];
  if (first === undefined) {
    throw new Error(
      `skillset: ad hoc test requires an enabled ${TARGET_LIST_TEXT} target`
    );
  }
  if (targets.length === 1) return first;
  return session.prompts.select({
    choices: targets.map((target) => ({
      name: `${target[0]?.toUpperCase() ?? ""}${target.slice(1)}`,
      value: target,
    })),
    default: first,
    message: "Run with:",
  });
}
