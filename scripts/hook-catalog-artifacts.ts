import Ajv2020 from "ajv/dist/2020";

import { buildHookCatalog, type HookCatalog } from "../packages/core/src/hook-catalog";
import { hookCatalogSchema } from "../packages/schema/src";

const CATALOG_DIR = "docs/reference/registry/v1";
const PROVIDER_DOCUMENTATION_HOSTS = new Set([
  "code.claude.com", "cursor.com", "developers.openai.com", "json.schemastore.org",
]);
const PINNED_BLOB = /^\/[^/]+\/[^/]+\/[a-f0-9]{40}\/.+/u;
const PINNED_GITHUB_BLOB = /^\/[^/]+\/[^/]+\/blob\/[a-f0-9]{40}\/.+/u;

function assertPublicSource(value: string, immutable = false): void {
  const url = new URL(value);
  const pinned = (url.hostname === "raw.githubusercontent.com" && PINNED_BLOB.test(url.pathname))
    || (url.hostname === "github.com" && PINNED_GITHUB_BLOB.test(url.pathname));
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || (!pinned && (immutable || !PROVIDER_DOCUMENTATION_HOSTS.has(url.hostname)))) {
    throw new Error(`Hook catalog evidence has a non-public or unpinned URL: ${value}`);
  }
}

export function assertHookCatalogIntegrity(catalog: HookCatalog): void {
  function requireEvidence(target: HookCatalog["targets"][number], refs: readonly string[]): void {
    for (const id of refs) {
      if (!Object.hasOwn(catalog.evidence, id) || catalog.evidence[id]?.target !== target) {
        throw new Error(`Hook catalog has an invalid evidence reference: ${target}/${id}`);
      }
    }
  }

  for (const { urls } of Object.values(catalog.evidence)) {
    for (const url of urls) assertPublicSource(url);
  }
  for (const target of catalog.targets) {
    const provider = catalog.providers[target];
    requireEvidence(target, provider.evidenceIds);
    for (const { source } of provider.outputLimits) assertPublicSource(source);
    for (const [id, event] of Object.entries(catalog.events)) {
      const relationship = event.providers[target];
      const { nativeName, fidelity } = relationship;
      requireEvidence(target, relationship.evidenceIds);
      if (nativeName === undefined) {
        if (fidelity !== "unknown" && fidelity !== "unavailable") {
          throw new Error(`Hook catalog is missing a native name: ${target}/${id}`);
        }
      } else if (!provider.events[nativeName]?.skillsetEventIds.includes(id)) {
        throw new Error(`Hook catalog is missing a reverse lookup: ${target}/${nativeName}/${id}`);
      }
    }

    for (const [name, event] of Object.entries(provider.events)) {
      requireEvidence(target, event.evidenceIds);
      for (const id of event.skillsetEventIds) {
        if (catalog.events[id]?.providers[target].nativeName !== name) {
          throw new Error(`Hook catalog is missing a forward lookup: ${target}/${id}/${name}`);
        }
      }
      for (const alias of event.sourceAliases) {
        if (!provider.nativeNamesByAlias[alias]?.includes(name)) {
          throw new Error(`Hook catalog is missing an alias: ${target}/${alias}/${name}`);
        }
      }
      for (const payload of [event.input, event.output.contract]) {
        if (payload.coverage !== "field-inventory" || payload.schemaRef === undefined) continue;
        const { url } = payload.schemaRef;
        assertPublicSource(url, true);
        if (!event.evidenceIds.some((id) => catalog.evidence[id]?.urls.includes(url))) {
          throw new Error(`Hook catalog schema link is not in its evidence: ${target}/${name}`);
        }
      }
    }
    for (const [alias, names] of Object.entries(provider.nativeNamesByAlias)) {
      for (const name of names) {
        if (!provider.events[name]?.sourceAliases.includes(alias)) {
          throw new Error(`Hook catalog alias does not resolve: ${target}/${alias}/${name}`);
        }
      }
    }
  }
}

export function buildHookCatalogArtifacts() {
  const catalog = buildHookCatalog();
  const ajv = new Ajv2020({ strict: true });
  const validate = ajv.compile(hookCatalogSchema);
  if (!validate(catalog)) {
    throw new Error(`Hook catalog does not match its schema: ${ajv.errorsText(validate.errors)}`);
  }
  assertHookCatalogIntegrity(catalog);
  return [
    { path: `${CATALOG_DIR}/hooks.json`, content: `${JSON.stringify(catalog, null, 2)}\n` },
    { path: `${CATALOG_DIR}/hooks.schema.json`, content: `${JSON.stringify(hookCatalogSchema, null, 2)}\n` },
  ];
}
