import { join } from "node:path";

/**
 * Where a render lands. Renderers that read prior output state (partial
 * settings files, the workspace lock) read it here, so an isolated build reads
 * its mirror rather than the live repository.
 */
export interface RenderDestination {
  /** Maps a logical output path to the path the build writes. */
  readonly mapPath: (path: string) => string;
  /** Resolves a mapped output path to an absolute file path. */
  readonly resolvePath: (path: string) => string;
}

export function liveRenderDestination(rootPath: string): RenderDestination {
  return { mapPath: (path) => path, resolvePath: (path) => join(rootPath, path) };
}
