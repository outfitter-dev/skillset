/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Create a successful result
 */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/**
 * Create a failed result
 */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Check if result is ok
 */
export const isOk = <T, E>(
  result: Result<T, E>
): result is { ok: true; value: T } => result.ok;

/**
 * Check if result is error
 */
export const isErr = <T, E>(
  result: Result<T, E>
): result is { ok: false; error: E } => !result.ok;

/**
 * Unwrap a result, throwing if it's an error
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
};

/**
 * Unwrap a result with a default value
 */
export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T =>
  result.ok ? result.value : defaultValue;

/**
 * Map over a successful result
 */
export const map = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> => (result.ok ? ok(fn(result.value)) : result);

/**
 * Map over an error result
 */
export const mapErr = <T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> => (result.ok ? result : err(fn(result.error)));
