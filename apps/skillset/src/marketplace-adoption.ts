import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

  const entries = catalogPluginNames(catalog);
  const adopted = new Set(adoptedPlugins);
  const plugins = entries.filter((name) => adopted.has(name) && PLUGIN_ID.test(name));
  const skippedPlugins = entries.filter((name) => !plugins.includes(name));
  const name = typeof catalog.name === "string" ? catalog.name : "";
  if (!CATALOG_NAME.test(name)) {
    return unadopted(skippedPlugins, `${CLAUDE_MARKETPLACE_PATH} name "${name}" is not a valid marketplace id; declare the catalog under marketplaces: by hand before the next build renames it`);
  }
  if (plugins.length === 0) {
    return unadopted(skippedPlugins, `${CLAUDE_MARKETPLACE_PATH} lists no adopted plugin; the next build replaces catalog ${name} with one named after the workspace`);
  }

  const configPath = join(rootPath, "skillset.yaml");
  const source = await readFile(configPath, "utf8");
  let declared = true;
  const next = updateYamlSourceDocument(source, configPath, (config) => {
    const marketplaces = isJsonRecord(config.marketplaces) ? config.marketplaces : {};
    if (Object.values(marketplaces).some(targetsClaude)) {
      declared = false;
      return config;
    }
    return {
      ...config,
      skillset: withOwner(isJsonRecord(config.skillset) ? config.skillset : {}, catalog.owner),
      marketplaces: {
        ...marketplaces,
        [name]: {
          ...descriptionOf(catalog),
          targets: ["claude"],
          plugins: plugins.map((plugin) => ({ plugin })),
        },
      },
    };
  });
  if (!declared) {
    return unadopted(skippedPlugins, `skillset.yaml already declares a Claude marketplace; ${CLAUDE_MARKETPLACE_PATH} (${name}) was not imported`);
  }
  await writeFile(configPath, next);
  return {
    catalog: name,
    path: CLAUDE_MARKETPLACE_PATH,
    skippedPlugins,
    warnings: skippedPlugins.length === 0
      ? []
      : [`marketplace ${name} entries not imported as Skillset plugins: ${skippedPlugins.join(", ")}`],
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

function catalogPluginNames(catalog: JsonRecord): readonly string[] {
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  return plugins.flatMap((entry) =>
    isJsonRecord(entry) && typeof entry.name === "string" ? [entry.name] : []
  );
}

function descriptionOf(catalog: JsonRecord): JsonRecord {
  const metadata = isJsonRecord(catalog.metadata) ? catalog.metadata : {};
  const description = catalog.description ?? metadata.description;
  return typeof description === "string" && description.trim().length > 0
    ? { description }
    : {};
}

/**
 * The build renders the catalog owner from `skillset.owner`, falling back to
 * `skillset.author`. Ordinary attribution belongs in `author`, so adoption only
 * writes `owner` when the catalog names a publisher distinct from the author.
 */
function withOwner(metadata: JsonRecord, owner: JsonRecord[string]): JsonRecord {
  if (!isJsonRecord(owner) || typeof owner.name !== "string") return metadata;
  if (metadata.owner !== undefined) return metadata;
  const author = isJsonRecord(metadata.author) ? metadata.author : undefined;
  if (author === undefined) return { ...metadata, author: owner };
  return author.name === owner.name ? metadata : { ...metadata, owner };
}

function targetsClaude(catalog: JsonRecord[string]): boolean {
  return isJsonRecord(catalog) &&
    (!Array.isArray(catalog.targets) || catalog.targets.includes("claude"));
}

function unadopted(skippedPlugins: readonly string[], warning: string): AdoptedMarketplace {
  return { path: CLAUDE_MARKETPLACE_PATH, skippedPlugins, warnings: [warning] };
}
