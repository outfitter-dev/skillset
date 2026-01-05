export interface CLIErrorOptions {
  exitCode?: number;
  alreadyLogged?: boolean;
}

export class CLIError extends Error {
  readonly exitCode: number;
  readonly alreadyLogged: boolean;

  constructor(message: string, options: CLIErrorOptions = {}) {
    super(message);
    this.name = "CLIError";
    this.exitCode = options.exitCode ?? 1;
    this.alreadyLogged = options.alreadyLogged ?? false;
  }
}

export function isCLIError(error: unknown): error is CLIError {
  return error instanceof CLIError;
}
