import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { getProviderSchemaSnapshot } from "@skillset/registry";
import { validateImportNormalizations, type ImportNormalization } from "@skillset/schema";

import { updateYamlSourceDocument } from "@skillset/core/internal/source-document";
import type { JsonRecord } from "@skillset/core/internal/types";
import { isJsonRecord } from "@skillset/core/internal/yaml";

/** The provider path of the Claude catalog an adopted repo may already ship. */
export const CLAUDE_MARKETPLACE_PATH = ".claude-plugin/marketplace.json";

const CATALOG_NAME = /^[a-z0-9][a-z0-9._-]*$/u;
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]*$/u;

/**
 * What adoption kept from an existing Claude catalog. Builds own the catalog
 * after adoption (SET-693), so its identity has to land in `skillset.yaml` or
 * the next build silently renames it to workspace defaults (SET-731).
 */
export interface AdoptedMarketplace {
  /** The declared catalog name, when adoption could declare one. */
  readonly catalog?: string;
  readonly path: typeof CLAUDE_MARKETPLACE_PATH;
  /** Catalog entries adoption could not carry into the declaration. */
  readonly skippedPlugins: readonly string[];
  readonly warnings: readonly string[];
  readonly normalizations?: readonly ImportNormalization[];
}

/**
 * Declares an adopted repo's existing Claude catalog in `skillset.yaml`,
 * keeping its name, owner and description, for the plugins adoption imported.
 * Returns `undefined` when the repo has no catalog.
 */
export async function adoptExistingMarketplace(
  rootPath: string,
  adoptedPlugins: readonly string[]
): Promise<AdoptedMarketplace | undefined> {
  const catalog = await readCatalog(join(rootPath, CLAUDE_MARKETPLACE_PATH));
  if (catalog === undefined) return undefined;
  if (catalog === "invalid") {
    return unadopted([], `${CLAUDE_MARKETPLACE_PATH} is not a JSON object with a name; the next build replaces it with a catalog named after the workspace`);
  }

  const { entries, ignoredIndices } = catalogPluginEntries(catalog);
  const warnings = ignoredIndices.length === 0 ? [] : [`${CLAUDE_MARKETPLACE_PATH} ignored plugin entries without a string name at ${ignoredIndices.map((index) => `/plugins/${index}`).join(", ")}; inspect the original catalog before cutover.`];
  const adopted = new Set(adoptedPlugins);
  const plugins = entries.filter(({ name }) => adopted.has(name) && PLUGIN_ID.test(name));
  const skippedPlugins = entries.filter((entry) => !plugins.includes(entry)).map((entry) => entry.name);
  const name = typeof catalog.name === "string" ? catalog.name : "";
  if (!CATALOG_NAME.test(name)) {
    return unadopted(skippedPlugins, `${CLAUDE_MARKETPLACE_PATH} name "${name}" is not a valid marketplace id; declare the catalog under marketplaces: by hand before the next build renames it`, warnings);
  }
  if (plugins.length === 0) {
    return unadopted(skippedPlugins, `${CLAUDE_MARKETPLACE_PATH} lists no adopted plugin; the next build replaces catalog ${name} with one named after the workspace`, warnings);
  }

  const configPath = join(rootPath, "skillset.yaml");
  const source = await readFile(configPath, "utf8");
  let undeclaredReason: string | undefined;
  const fields: MarketplaceObservationField[] = [];
  const next = updateYamlSourceDocument(source, configPath, (config) => {
    const marketplaces = isJsonRecord(config.marketplaces) ? config.marketplaces : {};
    if (Object.hasOwn(marketplaces, name)) {
      undeclaredReason = `skillset.yaml already declares marketplaces.${name}; ${CLAUDE_MARKETPLACE_PATH} (${name}) was not imported. Reconcile the catalog name and target membership explicitly.`;
      return config;
    }
    if (Object.values(marketplaces).some(targetsClaude)) {
      undeclaredReason = `skillset.yaml already declares a Claude marketplace; ${CLAUDE_MARKETPLACE_PATH} (${name}) was not imported`;
      return config;
    }
    const destination = `/marketplaces/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const description = descriptionOf(catalog);
    const owner = withOwner(isJsonRecord(config.skillset) ? config.skillset : {}, catalog.owner);
    if (owner.warning !== undefined) warnings.push(owner.warning);
    fields.push(
      { code: "marketplace.name", source: "/name", destination },
      { code: "marketplace.target", source: "", destination: `${destination}/targets` },
      ...(description === undefined ? [] : [{ code: "marketplace.description" as const, source: description.pointer, destination: `${destination}/description` }]),
      ...(owner.destination === undefined ? [] : [{ code: "marketplace.owner" as const, source: "/owner", destination: owner.destination }]),
      ...plugins.map((entry, index) => ({ code: "marketplace.plugin" as const, source: `/plugins/${entry.index}/name`, destination: `${destination}/plugins/${index}/plugin` })),
    );
    return {
      ...config,
      skillset: owner.metadata,
      marketplaces: {
        ...marketplaces,
        [name]: {
          ...(description === undefined ? {} : { description: description.value }),
          targets: ["claude"],
          plugins: plugins.map(({ name: plugin }) => ({ plugin })),
        },
      },
    };
  });
  if (undeclaredReason !== undefined) {
    return unadopted(skippedPlugins, undeclaredReason, warnings);
  }
  const normalizations = marketplaceObservations(fields);
  await writeFile(configPath, next);
  return {
    catalog: name,
    normalizations,
    path: CLAUDE_MARKETPLACE_PATH,
    skippedPlugins,
    warnings: [...warnings, ...(skippedPlugins.length === 0
      ? []
      : [`marketplace ${name} entries not imported as Skillset plugins: ${skippedPlugins.join(", ")}`])],
  };
}

async function readCatalog(path: string): Promise<JsonRecord | "invalid" | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonRecord(parsed) && typeof parsed.name === "string" ? parsed : "invalid";
  } catch {
    return "invalid";
  }
}

function catalogPluginEntries(catalog: JsonRecord): {
  readonly entries: readonly { readonly name: string; readonly index: number }[];
  readonly ignoredIndices: readonly number[];
} {
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  const entries: { name: string; index: number }[] = [];
  const ignoredIndices: number[] = [];
  for (const [index, entry] of plugins.entries()) {
    if (isJsonRecord(entry) && typeof entry.name === "string") entries.push({ name: entry.name, index });
    else ignoredIndices.push(index);
  }
  return { entries, ignoredIndices };
}

function descriptionOf(catalog: JsonRecord): { readonly value: string; readonly pointer: string } | undefined {
  const metadata = isJsonRecord(catalog.metadata) ? catalog.metadata : {};
  const description = catalog.description ?? metadata.description;
  return typeof description === "string" && description.trim().length > 0
    ? { value: description, pointer: catalog.description == null ? "/metadata/description" : "/description" }
    : undefined;
}

/**
 * The build renders the catalog owner from `skillset.owner`, falling back to
 * `skillset.author`. Ordinary attribution belongs in `author`, so adoption only
 * writes `owner` whenever the catalog attribution differs from the author.
 */
function withOwner(metadata: JsonRecord, owner: JsonRecord[string]): { readonly metadata: JsonRecord; readonly destination?: string; readonly warning?: string } {
  if (!isJsonRecord(owner) || typeof owner.name !== "string") return { metadata };
  if (metadata.owner !== undefined) return {
    metadata,
    ...(isDeepStrictEqual(metadata.owner, owner) ? {} : {
      warning: `Existing skillset.owner differs from ${CLAUDE_MARKETPLACE_PATH} owner; the explicit workspace owner was retained and the native catalog owner was not imported.`,
    }),
  };
  const author = isJsonRecord(metadata.author) ? metadata.author : undefined;
  if (author === undefined) return { metadata: { ...metadata, author: owner }, destination: "/skillset/author" };
  return isDeepStrictEqual(author, owner) ? { metadata } : { metadata: { ...metadata, owner }, destination: "/skillset/owner" };
}

function targetsClaude(catalog: JsonRecord[string]): boolean {
  return isJsonRecord(catalog) &&
    (!Array.isArray(catalog.targets) || catalog.targets.includes("claude"));
}

function unadopted(skippedPlugins: readonly string[], warning: string, additionalWarnings: readonly string[] = []): AdoptedMarketplace {
  return { path: CLAUDE_MARKETPLACE_PATH, skippedPlugins, warnings: [...additionalWarnings, warning] };
}


interface MarketplaceObservationField {
  readonly code: ImportNormalization["code"];
  readonly source: string;
  readonly destination: string;
}

/** Evidence of actual assignments; the generated target selector is derived from catalog origin. */
function marketplaceObservations(fields: readonly MarketplaceObservationField[]): readonly ImportNormalization[] {
  const snapshot = getProviderSchemaSnapshot("claude-marketplace-schema");
  const entries: ImportNormalization[] = fields.map((field) => ({
    code: field.code, dialect: "claude",
    source: { path: CLAUDE_MARKETPLACE_PATH, pointer: field.source },
    destination: { path: "skillset.yaml", pointer: field.destination },
    occurrences: 1, fidelity: "unknown",
    evidence: [
      field.code === "marketplace.target"
        ? "Derived Claude target selection from the Claude marketplace source location; the source root identifies this derivation, not an authored targets field."
        : "Observed marketplace input assigned to workspace configuration. Runtime equivalence and complete curated scope preservation are not established.",
      "https://code.claude.com/docs/en/plugins/marketplace-reference",
      "https://github.com/outfitter-dev/skillset/blob/main/docs/reference/features/marketplaces.md",
      ...(snapshot === undefined ? [] : [`Structural snapshot ${snapshot.id}: ${snapshot.provenance.contentHash}.`]),
      ...(snapshot?.provenance.sources.map((entry) => entry.url) ?? []),
    ],
    ...(snapshot === undefined ? {} : { observedAt: snapshot.provenance.fetchedAt.slice(0, 10) }),
  }));
  const validation = validateImportNormalizations(entries);
  if (!validation.ok) throw new Error(`skillset: marketplace normalization evidence is not representable: ${validation.diagnostics.map((item) => item.message).join("; ")}`);
  return entries;
}
