export class PromptCancelledError extends Error {
  readonly exitCode = 130;

  constructor() {
    super("skillset: interactive prompt cancelled");
    this.name = "PromptCancelledError";
  }
}
