/**
 * Base error class for skillset errors
 */
export class SkillsetError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SkillsetError";
    this.code = code;
    this.context = context;
  }
}

/**
 * Error for config-related issues
 */
export class ConfigError extends SkillsetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFIG_ERROR", context);
    this.name = "ConfigError";
  }
}

/**
 * Error for resolution failures
 */
export class ResolveError extends SkillsetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "RESOLVE_ERROR", context);
    this.name = "ResolveError";
  }
}

/**
 * Error for indexing issues
 */
export class IndexError extends SkillsetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "INDEX_ERROR", context);
    this.name = "IndexError";
  }
}

/**
 * Error for formatting issues
 */
export class FormatError extends SkillsetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "FORMAT_ERROR", context);
    this.name = "FormatError";
  }
}
