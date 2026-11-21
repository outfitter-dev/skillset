import { hooks } from "@skillset/registry/hooks";
import type { HookCatalog } from "@skillset/registry/hooks";

declare const key: string;
const catalog: HookCatalog = hooks;
const version: "skillset.registry.hooks@1" = catalog.schemaVersion;
const nativeName: string | undefined =
  catalog.events[key]?.providers.cursor.nativeName;

// @ts-expect-error A dynamic event might not exist.
void catalog.events[key].providers;
// @ts-expect-error A dynamic native event might not exist.
void catalog.providers.cursor.events[key].handlerTypes;
// @ts-expect-error A dynamic alias might not exist.
void catalog.providers.cursor.nativeNamesByAlias[key].length;
// @ts-expect-error A dynamic evidence record might not exist.
void catalog.evidence[key].basis;
// @ts-expect-error The implementation path is not exported.
export type { HookCatalog as Internal } from "@skillset/registry/dist/hooks.js";

export { nativeName, version };
