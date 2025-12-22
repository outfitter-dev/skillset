/**
 * TTY detection utilities
 */

/**
 * Check if running in an interactive terminal
 */
export function isTTY(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

/**
 * Check if color output is supported
 */
export function supportsColor(): boolean {
  // NO_COLOR environment variable takes precedence
  if (process.env.NO_COLOR === "1") {
    return false;
  }

  // Check if stdout is a TTY
  return Boolean(process.stdout.isTTY);
}
