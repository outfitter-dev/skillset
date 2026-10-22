/**
 * A workspace whose source root holds no plugins, skills, rules, project
 * agents, provider source, or marketplaces. Onboarding and authoring flows
 * expect it, so callers branch on this type, never on the message.
 */
export class EmptySourceGraphError extends Error {
  public constructor(sourceRoot: string) {
    super(`skillset: no source plugins, skills, rules, project agents, or provider source found under ${sourceRoot}/`);
    this.name = "EmptySourceGraphError";
  }
}

export function isEmptySourceGraphError(error: unknown): error is EmptySourceGraphError {
  return error instanceof EmptySourceGraphError;
}
