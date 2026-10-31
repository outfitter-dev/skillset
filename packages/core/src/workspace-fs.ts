import * as fs from "node:fs";
import * as asyncFs from "node:fs/promises";
import {
  hasWorkspaceReadBoundary,
  prepareWorkspaceRead,
  prepareWorkspaceReadSync,
} from "./workspace-read-boundary";

// Preserve Node's overloads and options. Outside status these are direct calls;
// inside status only the first (path) operand changes to its guarded location.
function asyncRead<F extends (...args: never[]) => unknown>(read: () => F): F {
  return ((path: unknown, ...args: unknown[]) => {
    if (!hasWorkspaceReadBoundary()) return Reflect.apply(read(), undefined, [path, ...args]);
    return prepareWorkspaceRead(path).then((guarded) => Reflect.apply(read(), undefined, [guarded, ...args]));
  }) as unknown as F;
}

function syncRead<F extends (...args: never[]) => unknown>(read: () => F): F {
  return ((path: unknown, ...args: unknown[]) => {
    const guarded = hasWorkspaceReadBoundary() ? prepareWorkspaceReadSync(path) : path;
    return Reflect.apply(read(), undefined, [guarded, ...args]);
  }) as unknown as F;
}

export const access = asyncRead(() => asyncFs.access);
export const open = asyncRead(() => asyncFs.open);
export const lstat = asyncRead(() => asyncFs.lstat);
export const readdir = asyncRead(() => asyncFs.readdir);
export const readFile = asyncRead(() => asyncFs.readFile);
export const realpath = asyncRead(() => asyncFs.realpath);
export const stat = asyncRead(() => asyncFs.stat);
export const existsSync = syncRead(() => fs.existsSync);
export const lstatSync = syncRead(() => fs.lstatSync);
export const readdirSync = syncRead(() => fs.readdirSync);
export const readFileSync = syncRead(() => fs.readFileSync);
export const realpathSync = syncRead(() => fs.realpathSync);
export const statSync = syncRead(() => fs.statSync);
