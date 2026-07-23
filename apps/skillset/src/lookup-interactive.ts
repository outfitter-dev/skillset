import {
  listLookupFields,
  listLookupSubjects,
  listLookupViews,
  targetNames,
  type LookupSubject,
  type LookupView,
} from "@skillset/core";
import type { TargetName } from "@skillset/core/internal/types";

import type { LookupRouteRequest } from "./inspect-cli";
import type { InteractiveSession } from "./interactive-session";

const ALL_FIELDS = "__all_lookup_fields__";

export function lookupRequestNeedsPrompts(
  request: LookupRouteRequest
): boolean {
  return (
    !request.jsonOutput &&
    (request.lookupSubject === undefined ||
      (request.lookupAspects.length === 0 &&
        request.lookupField === undefined &&
        request.lookupViews.length === 0))
  );
}

export async function resolveInteractiveLookup(
  request: LookupRouteRequest,
  session: InteractiveSession
): Promise<LookupRouteRequest> {
  const subject =
    request.lookupSubject ?? (await promptForSubject(request, session));
  const needsView =
    request.lookupAspects.length === 0 &&
    request.lookupField === undefined &&
    request.lookupViews.length === 0;
  const selectedView = needsView
    ? await promptForView(subject, session)
    : undefined;
  const views =
    selectedView === undefined ? request.lookupViews : [selectedView];
  const targets =
    selectedView === "compat" || selectedView === "events"
      ? await promptForTargets(session)
      : request.lookupTargets;
  const field =
    request.lookupField ??
    (selectedView === "fields" || selectedView === "values"
      ? await promptForField(subject, request.lookupAspects, session)
      : undefined);

  return {
    ...request,
    lookupField: field,
    lookupSubject: subject,
    lookupTargets: targets,
    lookupViews: views,
  };
}

async function promptForSubject(
  request: LookupRouteRequest,
  session: InteractiveSession
): Promise<LookupSubject> {
  const subjects = listLookupSubjects({
    aspects: request.lookupAspects,
    ...(request.lookupField === undefined
      ? {}
      : { field: request.lookupField }),
    views: request.lookupViews,
  });
  return session.prompts.search({
    message: "Look up:",
    source: (term) =>
      filterChoices(
        term,
        subjects.map((subject) => ({
          description: subject.description,
          name: displayName(subject.subject),
          value: subject.subject,
        }))
      ),
  });
}

async function promptForView(
  subject: LookupSubject,
  session: InteractiveSession
): Promise<LookupView> {
  return session.prompts.select({
    choices: listLookupViews(subject).map((view) => ({
      name: displayName(view),
      value: view,
    })),
    message: "Show:",
  });
}

async function promptForTargets(
  session: InteractiveSession
): Promise<readonly TargetName[]> {
  return session.prompts.checkbox({
    choices: targetNames().map((target) => ({
      checked: true,
      name: displayName(target),
      value: target,
    })),
    message: "Compare:",
    required: true,
  });
}

async function promptForField(
  subject: LookupSubject,
  aspects: readonly string[],
  session: InteractiveSession
): Promise<string | undefined> {
  const fields = listLookupFields({ aspects, subject });
  if (fields.length === 0) return undefined;
  const selection = await session.prompts.search({
    default: ALL_FIELDS,
    message: "Field:",
    source: (term) =>
      filterChoices(term, [
        {
          description: "Show every top-level field",
          name: "All fields",
          value: ALL_FIELDS,
        },
        ...fields.map((field) => ({
          description: field.description ?? field.type,
          name: field.path,
          value: field.path,
        })),
      ]),
  });
  return selection === ALL_FIELDS ? undefined : selection;
}

function filterChoices<Value>(
  term: string | undefined,
  choices: readonly {
    readonly description?: string;
    readonly name: string;
    readonly value: Value;
  }[]
): readonly {
  readonly description?: string;
  readonly name: string;
  readonly value: Value;
}[] {
  const query = term?.trim().toLowerCase() ?? "";
  return query.length === 0
    ? choices
    : choices.filter((choice) =>
        `${choice.name} ${choice.description ?? ""}`
          .toLowerCase()
          .includes(query)
      );
}

function displayName(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
