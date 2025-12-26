/**
 * Shared types for CLI commands
 */

export type OutputFormat = "text" | "raw" | "json";

export type ConfigScope = "project" | "user";

export interface GlobalOptions {
  source?: string[];
  json?: boolean;
  raw?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  kind?: "skill" | "set";
}
