/* eslint-disable func-style, no-loop-func, no-use-before-define -- Small structural rewrite helpers mirror the authored config grammar. */
/* eslint-disable typescript/no-dynamic-delete -- Config keys are authored plugin ids and selector groups. */

import type { SkillsetSourceReferenceDescriptorId } from "@skillset/schema";

import {
  updateMarkdownSourceDocument,
  updateYamlSourceDocument,
} from "./source-document";
import { SourceMovePlanError } from "./source-move-types";
import {
  assertRewrittenSourceReference,
  sourceReferenceAcceptsSelector,
} from "./source-reference-contract";
import { writableRecord } from "./source-rename-structured";
import type { JsonRecord } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

export interface SourceMoveConfigRewrite {
  readonly fromSelector: string;
  readonly internalUsePluginId?: string;
  readonly leaf: string;
  readonly movePluginDraftToWorkspace?: boolean;
  /** The root config or manifest contract, when this document is one of them. */
  readonly rootContract?: "root-source-manifest" | "workspace-config";
  readonly sourcePluginDocument: boolean;
  readonly toSelector: string;
}

export interface SourceMoveConfigRewriteResult {
  readonly content: string;
  readonly removedInternalUse: boolean;
}

export function rewriteSourceMoveConfig(
  source: string,
  path: string,
  rewrite: SourceMoveConfigRewrite
): SourceMoveConfigRewriteResult {
  assertRewrittenSourceReference("configured-draft-selector");
  assertRewrittenSourceReference("distribution-source-selector");
  assertRewrittenSourceReference("internal-plugin-selection");
  let removedInternalUse = false;
  const content = updateYamlSourceDocument(source, path, (current) => {
    let updated = current;
    if (rewrite.rootContract !== undefined) {
      updated = rewriteRootSelectors(updated, rewrite, rewrite.rootContract);
      const internalUse = removeInternalUseSelection(updated, rewrite);
      updated = internalUse.config;
      removedInternalUse = internalUse.removed;
    }
    if (rewrite.sourcePluginDocument && rewrite.movePluginDraftToWorkspace) {
      updated = removePluginDraftDeclaration(updated, rewrite.leaf);
    }
    return updated;
  });
  return { content, removedInternalUse };
}

function rewriteRootSelectors(
  config: JsonRecord,
  rewrite: SourceMoveConfigRewrite,
  contract: "root-source-manifest" | "workspace-config"
): JsonRecord {
  const updated = writableRecord(config);
  if (Array.isArray(config.drafts)) {
    const drafts = config.drafts.map((item) =>
      item === rewrite.fromSelector
        ? acceptedSelector("configured-draft-selector", contract, "drafts", rewrite)
        : item
    );
    if (
      rewrite.movePluginDraftToWorkspace &&
      !drafts.includes(rewrite.toSelector)
    ) {
      drafts.push(rewrite.toSelector);
    }
    updated.drafts = [...new Set(drafts)];
  } else if (rewrite.movePluginDraftToWorkspace) {
    updated.drafts = [rewrite.toSelector];
  }

  if (isJsonRecord(config.distributions)) {
    updated.distributions = Object.fromEntries(
      Object.entries(config.distributions).map(([id, value]) => {
        if (!isJsonRecord(value) || !isJsonRecord(value.from)) {
          return [id, value];
        }
        return [
          id,
          value.from.selector === rewrite.fromSelector
            ? {
                ...value,
                from: {
                  ...value.from,
                  selector: acceptedSelector(
                    "distribution-source-selector",
                    contract,
                    `distributions.${id}.from.selector`,
                    rewrite
                  ),
                },
              }
            : value,
        ];
      })
    );
  }
  return updated;
}

/**
 * Rewrites `Scope:`/`Scopes:` directives in a reason-only pending change entry,
 * or `scope`/`scopes` frontmatter in a frontmatter entry.
 */
export function rewritePendingChangeScopes(
  source: string,
  path: string,
  rewrite: Pick<SourceMoveConfigRewrite, "fromSelector" | "toSelector">
): string {
  assertRewrittenSourceReference("pending-change-scope");
  const scope = (value: string): string =>
    value === rewrite.fromSelector ? rewrite.toSelector : value;
  // Classify like the pending-change reader: only non-empty frontmatter makes a frontmatter entry.
  if (Object.keys(parseMarkdown(source, path).frontmatter).length === 0) {
    return source.replaceAll(
      /^(Scopes?:[ \t]*)(.*)$/gimu,
      (line, key: string, value: string) => {
        const items = value.split(",").map((item) => item.trim());
        return items.includes(rewrite.fromSelector)
          ? `${key}${items.map(scope).join(", ")}`
          : line;
      }
    );
  }
  return updateMarkdownSourceDocument(source, path, (current) => {
    const frontmatter = writableRecord(current.frontmatter);
    for (const key of ["scope", "scopes"] as const) {
      const value = frontmatter[key];
      if (typeof value === "string") {
        frontmatter[key] = scope(value);
      } else if (Array.isArray(value)) {
        frontmatter[key] = value.map((item) =>
          typeof item === "string" ? scope(item) : item
        );
      }
    }
    return { body: current.body, frontmatter };
  });
}

function acceptedSelector(
  id: SkillsetSourceReferenceDescriptorId,
  contract: "root-source-manifest" | "workspace-config",
  field: string,
  rewrite: Pick<SourceMoveConfigRewrite, "fromSelector" | "toSelector">
): string {
  if (!sourceReferenceAcceptsSelector(id, contract, rewrite.toSelector)) {
    throw new SourceMovePlanError(
      `cannot rewrite ${field} from ${rewrite.fromSelector} to ${rewrite.toSelector}; ${contract} does not accept that selector there. Update or remove that reference before moving`
    );
  }
  return rewrite.toSelector;
}

function removePluginDraftDeclaration(
  config: JsonRecord,
  leaf: string
): JsonRecord {
  if (!Array.isArray(config.drafts)) {
    return config;
  }
  const drafts = config.drafts.filter((item) => item !== `skill:${leaf}`);
  if (drafts.length === config.drafts.length) {
    return config;
  }
  const updated = writableRecord(config);
  if (drafts.length === 0) {
    delete updated.drafts;
  } else {
    updated.drafts = drafts;
  }
  return updated;
}

function removeInternalUseSelection(
  config: JsonRecord,
  rewrite: SourceMoveConfigRewrite
): { readonly config: JsonRecord; readonly removed: boolean } {
  const pluginId = rewrite.internalUsePluginId;
  if (
    pluginId === undefined ||
    !isJsonRecord(config.plugins) ||
    !isJsonRecord(config.plugins.internal_use)
  ) {
    return { config, removed: false };
  }

  let removed = false;
  const internalUse = writableRecord(config.plugins.internal_use);
  for (const key of ["skills", "drafts"] as const) {
    const byPlugin = internalUse[key];
    if (!isJsonRecord(byPlugin)) {
      continue;
    }
    const selection = byPlugin[pluginId];
    if (!Array.isArray(selection)) {
      continue;
    }
    const retained = selection.filter((item) => {
      const matches =
        typeof item === "string" && item.replace(/^!/u, "") === rewrite.leaf;
      removed ||= matches;
      return !matches;
    });
    if (retained.length === selection.length) {
      continue;
    }
    const nextByPlugin = writableRecord(byPlugin);
    if (retained.length === 0) {
      delete nextByPlugin[pluginId];
    } else {
      nextByPlugin[pluginId] = retained;
    }
    if (Object.keys(nextByPlugin).length === 0) {
      delete internalUse[key];
    } else {
      internalUse[key] = nextByPlugin;
    }
  }
  if (!removed) {
    return { config, removed: false };
  }

  const plugins = writableRecord(config.plugins);
  if (Object.keys(internalUse).length === 0) {
    delete plugins.internal_use;
  } else {
    plugins.internal_use = internalUse;
  }
  const updated = writableRecord(config);
  if (Object.keys(plugins).length === 0) {
    delete updated.plugins;
  } else {
    updated.plugins = plugins;
  }
  return { config: updated, removed: true };
}
