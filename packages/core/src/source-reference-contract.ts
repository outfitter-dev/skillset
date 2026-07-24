/* eslint-disable func-style -- Named exported contract guards read as assertions at call sites. */

import {
  getSkillsetSourceReferenceDescriptor,
  skillsetSourceReferenceDescriptors,
} from "@skillset/schema";
import type { SkillsetSourceReferenceDescriptorId } from "@skillset/schema";

type CoreReferenceHandler =
  | "agent-skills"
  | "hook-attachments"
  | "hook-script"
  | "internal-plugin-dependency"
  | "resource-destination"
  | "resource-source"
  | "skill-eval-file"
  | "skill-eval-name";

const coreReferenceHandlers = {
  "adaptive-hook-run-script": "hook-script",
  "agent-skills": "agent-skills",
  "hook-attachment": "hook-attachments",
  "internal-plugin-dependency": "internal-plugin-dependency",
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
