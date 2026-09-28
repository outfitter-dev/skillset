/* eslint-disable func-style -- Named exported contract guards read as assertions at call sites. */

import {
  getSkillsetSourceReferenceDescriptor,
  skillsetSourceReferenceDescriptors,
} from "@skillset/schema";
import type {
  SkillsetSourceReferenceContract,
  SkillsetSourceReferenceDescriptorId,
} from "@skillset/schema";

type CoreReferenceHandler =
  | "agent-skills"
  | "configured-draft-selector"
  | "distribution-source-selector"
  | "hook-attachments"
  | "hook-script"
  | "internal-plugin-dependency"
  | "internal-plugin-selection"
  | "pending-change-scope"
  | "resource-destination"
  | "resource-source"
  | "skill-eval-file"
  | "skill-eval-name";

const coreReferenceHandlers = {
  "adaptive-hook-run-script": "hook-script",
  "agent-skills": "agent-skills",
  "configured-draft-selector": "configured-draft-selector",
  "distribution-source-selector": "distribution-source-selector",
  "hook-attachment": "hook-attachments",
  "internal-plugin-dependency": "internal-plugin-dependency",
  "internal-plugin-selection": "internal-plugin-selection",
  "pending-change-scope": "pending-change-scope",
  "skill-eval-file": "skill-eval-file",
  "skill-eval-skill-name": "skill-eval-name",
  "skill-resource-destination": "resource-destination",
  "skill-resource-source": "resource-source",
} as const satisfies Record<
  SkillsetSourceReferenceDescriptorId,
  CoreReferenceHandler
>;

export function sourceReferenceHandler(
  id: SkillsetSourceReferenceDescriptorId
): CoreReferenceHandler {
  const descriptor = getSkillsetSourceReferenceDescriptor(id);
  const handler = coreReferenceHandlers[descriptor.id];
  if (handler === undefined) {
    throw new Error(
      `skillset: Core has no handler for source reference descriptor ${descriptor.id}`
    );
  }
  return handler;
}

export function assertSourceReferenceContract(): void {
  for (const descriptor of skillsetSourceReferenceDescriptors) {
    sourceReferenceHandler(descriptor.id);
  }
}

export function assertRewrittenSourceReference(
  id: SkillsetSourceReferenceDescriptorId
): void {
  const descriptor = getSkillsetSourceReferenceDescriptor(id);
  sourceReferenceHandler(id);
  if (descriptor.mutationPolicy !== "rewrite") {
    throw new Error(
      `skillset: source reference descriptor ${id} must use rewrite policy`
    );
  }
}

/**
 * Whether a rewritten selector matches the schema pattern the descriptor
 * declares for this contract. A descriptor without one is a programmer error.
 */
export function sourceReferenceAcceptsSelector(
  id: SkillsetSourceReferenceDescriptorId,
  contract: SkillsetSourceReferenceContract,
  selector: string
): boolean {
  const pattern =
    getSkillsetSourceReferenceDescriptor(id).acceptedSelectorPatterns?.[
      contract
    ];
  if (pattern === undefined) {
    throw new Error(
      `skillset: source reference descriptor ${id} declares no selector pattern for ${contract}`
    );
  }
  return new RegExp(pattern, "u").test(selector);
}
