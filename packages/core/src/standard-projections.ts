import {
  listStandardProfiles,
  type StandardProfile,
  type StandardProfileId,
} from '@skillset/registry'

import { DEFAULT_PLUGIN_OUTPUT_ROOT } from './plugin-output'

import type {
  StandardProjectionPlan,
  SourcePlugin,
  SourceRule,
  StandaloneSkill,
} from './types'

export type StandardProjectionFamily = 'instructions' | 'plugins' | 'skills'

export interface StandardProjectionSourceInventory {
  readonly instructions: number
  readonly plugins: number
  readonly skills: number
}

/** Standalone skills use Agent Skills; plugin skills live in Agent Plugins. */
export function standardProjectionSourceInventory(input: {
  readonly plugins: readonly SourcePlugin[]
  readonly rules: readonly SourceRule[]
  readonly standaloneSkills: readonly StandaloneSkill[]
}): StandardProjectionSourceInventory {
  return {
    instructions: input.rules.length,
    plugins: input.plugins.length,
    skills: input.standaloneSkills.length,
  }
}

/**
 * Each adopted profile applies to one portable source family. Candidate and
 * retired profiles never become production output or lock identity.
 */
const PROFILE_FAMILIES: Readonly<Record<StandardProfileId, StandardProjectionFamily>> = {
  'agent-instructions': 'instructions',
  'agent-plugins-1.0': 'plugins',
  'agent-skills': 'skills',
}

export function resolveStandardProjectionPlan(
  inventory: StandardProjectionSourceInventory,
  profiles: readonly StandardProfile[] = listStandardProfiles()
): StandardProjectionPlan {
  const adopted: StandardProfileId[] = []
  const adoptionReceiptHashes: Partial<
    Record<StandardProfileId, `sha256:${string}`>
  > = {}

  for (const profile of profiles) {
    const family = PROFILE_FAMILIES[profile.id]
    if (profile.lifecycle !== 'adopted') continue
    const receipt = profile.adoption?.receipt
    if (receipt === undefined) {
      throw new Error(
        `skillset: adopted standard profile ${profile.id} has no adoption receipt evidence`
      )
    }
    if (inventory[family] > 0) {
      adopted.push(profile.id)
      adoptionReceiptHashes[profile.id] = receipt.contentHash
    }
  }

  return { adopted: requestedIds(adopted), adoptionReceiptHashes }
}

/**
 * Resolve one candidate profile for the repository-internal conformance lane.
 * This does not change registry state or make the profile eligible for normal
 * builds; the returned plan is consumed only by the private candidate renderer.
 */
export function resolveCandidateStandardProjectionPlan(
  inventory: StandardProjectionSourceInventory,
  profileId: StandardProfileId,
  profiles: readonly StandardProfile[] = listStandardProfiles()
): StandardProjectionPlan {
  const profile = profiles.find(candidate => candidate.id === profileId)
  if (profile === undefined) {
    throw new Error(`skillset: unknown standard profile ${profileId}`)
  }
  if (profile.lifecycle !== 'candidate') {
    throw new Error(
      `skillset: candidate conformance requires a candidate standard profile; ${profileId} is ${profile.lifecycle}`
    )
  }

  const family = PROFILE_FAMILIES[profile.id]
  if (inventory[family] === 0) {
    throw new Error(
      `skillset: candidate standard profile ${profileId} has no applicable ${family} source`
    )
  }

  return { adopted: [profileId], adoptionReceiptHashes: {} }
}

function requestedIds(ids: readonly StandardProfileId[]): readonly StandardProfileId[] {
  return [...ids].sort()
}

export const AGENT_SKILLS_OUTPUT_ROOT = '.agents/skills'

export interface StandardProjectionOutputTopology {
  readonly lockRoot: '.' | typeof AGENT_SKILLS_OUTPUT_ROOT | typeof DEFAULT_PLUGIN_OUTPUT_ROOT
  readonly path: string
  readonly scope: 'plugins' | 'project' | 'repo'
  readonly standardProfile: StandardProfileId
}

export const STANDARD_PROJECTION_MANAGED_ROOTS = [
  { path: AGENT_SKILLS_OUTPUT_ROOT, scope: 'repo' },
  { path: DEFAULT_PLUGIN_OUTPUT_ROOT, scope: 'plugins' },
] as const

/**
 * The three standards roots are fixed by the adopted profiles. They stay
 * separate from provider targets so a standard cannot become a fourth target.
 */
export function standardProjectionTopology(
  plan: StandardProjectionPlan,
  pluginIds: readonly string[]
): readonly StandardProjectionOutputTopology[] {
  const topology: StandardProjectionOutputTopology[] = []
  if (plan.adopted.includes('agent-instructions')) {
    topology.push({
      lockRoot: '.',
      path: 'AGENTS.md',
      scope: 'project',
      standardProfile: 'agent-instructions',
    })
  }
  if (plan.adopted.includes('agent-skills')) {
    topology.push({
      lockRoot: AGENT_SKILLS_OUTPUT_ROOT,
      path: AGENT_SKILLS_OUTPUT_ROOT,
      scope: 'repo',
      standardProfile: 'agent-skills',
    })
  }
  if (plan.adopted.includes('agent-plugins-1.0')) {
    for (const pluginId of [...pluginIds].sort()) {
      topology.push({
        lockRoot: DEFAULT_PLUGIN_OUTPUT_ROOT,
        path: `${DEFAULT_PLUGIN_OUTPUT_ROOT}/${pluginId}`,
        scope: 'plugins',
        standardProfile: 'agent-plugins-1.0',
      })
    }
  }
  return topology
}

/** Managed root locks for standards projections that own directory trees. */
export function standardProjectionManagedOutputRoots(
  plan: StandardProjectionPlan
): readonly string[] {
  const roots: string[] = []
  if (plan.adopted.includes('agent-skills')) roots.push(AGENT_SKILLS_OUTPUT_ROOT)
  if (plan.adopted.includes('agent-plugins-1.0')) roots.push(DEFAULT_PLUGIN_OUTPUT_ROOT)
  return roots
}
/**
 * Fixed standard roots remain discoverable after their profile stops applying.
 * A validated prior lock, rather than current resolution, grants cleanup
 * authority; callers still decide whether a historical root actually exists.
 */
export function standardProjectionKnownManagedOutputRoots(): readonly {
  readonly label: string
  readonly path: string
}[] {
  return STANDARD_PROJECTION_MANAGED_ROOTS.map(root => ({
    label: root.path === AGENT_SKILLS_OUTPUT_ROOT
      ? 'standards.agent-skills'
      : 'standards.agent-plugins-1.0',
    path: root.path,
  }))
}

export function standardProjectionManagedRootScope(
  path: string
): 'plugins' | 'repo' | undefined {
  const root = STANDARD_PROJECTION_MANAGED_ROOTS.find(candidate =>
    path === candidate.path || path.startsWith(`${candidate.path}/`)
  )
  return root?.scope
}
