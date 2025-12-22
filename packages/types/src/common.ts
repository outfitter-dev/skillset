/**
 * Common utility types
 */

import type { ResolveResult } from "./skill";

export interface InjectOutcome {
  resolved: ResolveResult[];
  warnings: string[];
  context: string;
}
