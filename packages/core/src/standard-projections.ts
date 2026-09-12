import {
  listStandardProfiles,
  type StandardProfile,
  type StandardProfileId,
} from '@skillset/registry'

import type {
  AgentStandardsConfig,
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

/** Every portable skill source is eligible for the Agent Skills projection. */
export function standardProjectionSourceInventory(input: {
  readonly plugins: readonly SourcePlugin[]
  readonly rules: readonly SourceRule[]
  readonly standaloneSkills: readonly StandaloneSkill[]
}): StandardProjectionSourceInventory {
  return {
    instructions: input.rules.length,
    plugins: input.plugins.length,
    skills:
      input.standaloneSkills.length +
      input.plugins.reduce((count, plugin) => count + plugin.skills.length, 0),
  }
}

/**
 * A profile that can be emitted by the normal production renderer. Candidate
 * profiles remain visible in the plan so callers can explain why they did not
 * satisfy a standards-only build, but never become output or lock identity.
 */
const PROFILE_FAMILIES: Readonly<Record<StandardProfileId, StandardProjectionFamily>> = {
  'agent-instructions': 'instructions',
  'agent-plugins-1.0': 'plugins',
  'agent-skills': 'skills',
}

export function resolveStandardProjectionPlan(
  config: AgentStandardsConfig,
  inventory: StandardProjectionSourceInventory,
  explicitFamilies: readonly StandardProjectionFamily[] = [],
  profiles: readonly StandardProfile[] = listStandardProfiles()
): StandardProjectionPlan {
  const adopted: StandardProfileId[] = []
  const explicitNonAdopted: StandardProfileId[] = []
  const explicit = new Set(explicitFamilies)

  for (const profile of profiles) {
    const family = PROFILE_FAMILIES[profile.id]
    if (!config[family]) continue
    if (profile.lifecycle !== 'adopted') {
      if (explicit.has(family)) explicitNonAdopted.push(profile.id)
      continue
    }
    if (inventory[family] > 0) {
      adopted.push(profile.id)
    }
  }

  return {
    adopted: requestedIds(adopted),
    explicitNonAdopted: requestedIds(explicitNonAdopted),
  }
}

function requestedIds(ids: readonly StandardProfileId[]): readonly StandardProfileId[] {
  return [...ids].sort()
}

export interface StandardProjectionOutputTopology {
  readonly lockRoot: '.' | '.agents/skills' | 'plugins'
  readonly path: string
  readonly scope: 'plugins' | 'project' | 'repo'
  readonly standardProfile: StandardProfileId
}

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
      lockRoot: '.agents/skills',
      path: '.agents/skills',
      scope: 'repo',
      standardProfile: 'agent-skills',
    })
  }
  if (plan.adopted.includes('agent-plugins-1.0')) {
    for (const pluginId of [...pluginIds].sort()) {
      topology.push({
        lockRoot: 'plugins',
        path: 'plugins/' + pluginId + '/agents',
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
  if (plan.adopted.includes('agent-skills')) roots.push('.agents/skills')
  if (plan.adopted.includes('agent-plugins-1.0')) roots.push('plugins')
  return roots
}

export function standardProjectionNonAdoptedDetail(
  plan: StandardProjectionPlan
): string | undefined {
  if (plan.explicitNonAdopted.length === 0) return undefined
  const noun = plan.explicitNonAdopted.length === 1 ? 'is' : 'are'
  return [
    `selected Agent standards profile${plan.explicitNonAdopted.length === 1 ? '' : 's'} ${plan.explicitNonAdopted.join(', ')} ${noun} not adopted`,
    'non-adopted profiles cannot produce normal output, locks, or adoption claims',
  ].join('; ')
}
