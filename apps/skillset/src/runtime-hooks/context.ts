import {
  readRuntimeContext,
  readRuntimeContextField,
  readRuntimeContextFormat,
  renderRuntimeContext,
  type RuntimeContext,
  type RuntimeContextField,
  type RuntimeContextFormat,
  type RuntimeContextOptions,
  type RuntimeContextRenderOptions,
  type RuntimeProvider,
} from "@skillset/toolkit/runtime";

export const readHookRuntimeContext = readRuntimeContext;
export const readHookRuntimeContextField = readRuntimeContextField;
export const readHookRuntimeContextFormat = readRuntimeContextFormat;
export const renderHookRuntimeContext = renderRuntimeContext;
export type HookRuntimeContext = RuntimeContext;
export type HookRuntimeContextField = RuntimeContextField;
export type HookRuntimeContextFormat = RuntimeContextFormat;
export type HookRuntimeContextOptions = RuntimeContextOptions;
export type HookRuntimeContextRenderOptions = RuntimeContextRenderOptions;
export type HookRuntimeProvider = RuntimeProvider;

export async function readHookStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const text = await new Response(Bun.stdin.stream()).text();
  return text.trim().length === 0 ? undefined : text;
}
