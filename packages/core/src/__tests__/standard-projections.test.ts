import { describe, expect, test } from 'bun:test'
import { listStandardProfiles, type StandardProfile } from '@skillset/registry'

import {
  resolveStandardProjectionPlan,
  standardProjectionNonAdoptedDetail,
  standardProjectionManagedOutputRoots,
  standardProjectionSourceInventory,
  standardProjectionTopology,
} from '../standard-projections'
import { scopedOutputRoots, scopedRenderedFiles } from '../build'
import { validateOutputRoots } from '../resolver'
import type { BuildGraph, RenderedFile, SourcePlugin, SourceRule, StandaloneSkill } from '../types'

const allStandards = { instructions: true, plugins: true, skills: true }
const allSource = { instructions: 1, plugins: 1, skills: 1 }

describe('standard projection selection', () => {
  test('keeps source applicability independent from provider toggles', () => {
    const plan = resolveStandardProjectionPlan(allStandards, allSource, [], adoptedProfiles())

    expect(plan).toEqual({
      adopted: ['agent-instructions', 'agent-plugins-1.0', 'agent-skills'],
      explicitNonAdopted: [],
    })
  })

  test.each([
    [{ instructions: false, plugins: true, skills: true }, ['agent-plugins-1.0', 'agent-skills']],
    [{ instructions: true, plugins: false, skills: true }, ['agent-instructions', 'agent-skills']],
    [
      { instructions: true, plugins: true, skills: false },
      ['agent-instructions', 'agent-plugins-1.0'],
    ],
    [allStandards, []],
  ] as const)('selects only enabled and applicable standard families', (config, expected) => {
    const inventory = expected.length === 0 ? { instructions: 0, plugins: 0, skills: 0 } : allSource
    expect(resolveStandardProjectionPlan(config, inventory, [], adoptedProfiles()).adopted).toEqual(
      expected
    )
  })

  test('counts standalone and plugin-owned skills for Agent Skills applicability', () => {
    expect(
      standardProjectionSourceInventory({
        plugins: [{ skills: [{}, {}] } as unknown as SourcePlugin],
        rules: [{}] as SourceRule[],
        standaloneSkills: [{}] as StandaloneSkill[],
      })
    ).toEqual({ instructions: 1, plugins: 1, skills: 3 })

    const pluginOnly = standardProjectionSourceInventory({
      plugins: [{ skills: [{}] } as unknown as SourcePlugin],
      rules: [],
      standaloneSkills: [],
    })
    expect(
      resolveStandardProjectionPlan(
        { instructions: false, plugins: false, skills: true },
        pluginOnly,
        [],
        adoptedProfiles()
      ).adopted
    ).toEqual(['agent-skills'])
  })

  test('assigns adopted standards to protected roots and existing scopes', () => {
    const plan = adoptedPlan()

    expect(standardProjectionTopology(plan, ['beta', 'alpha'])).toEqual([
      {
        lockRoot: '.',
        path: 'AGENTS.md',
        scope: 'project',
        standardProfile: 'agent-instructions',
      },
      {
        lockRoot: '.agents/skills',
        path: '.agents/skills',
        scope: 'repo',
        standardProfile: 'agent-skills',
      },
      {
        lockRoot: 'plugins',
        path: 'plugins/alpha/agents',
        scope: 'plugins',
        standardProfile: 'agent-plugins-1.0',
      },
      {
        lockRoot: 'plugins',
        path: 'plugins/beta/agents',
        scope: 'plugins',
        standardProfile: 'agent-plugins-1.0',
      },
    ])
    expect(standardProjectionManagedOutputRoots(plan)).toEqual(['.agents/skills', 'plugins'])
  })

  test('uses standard topology for scope routing under custom provider roots', () => {
    const graph = graphForScope(adoptedPlan())
    const files = [
      { path: 'AGENTS.md' },
      { path: '.agents/skills/review/SKILL.md' },
      { path: 'plugins/demo/agents/plugin.json' },
      { path: 'plugins/README.md' },
      { path: 'plugins/skillset.lock' },
    ] as RenderedFile[]

    expect(scopedRenderedFiles(graph, files, ['project']).map(file => file.path)).toEqual([
      'AGENTS.md',
    ])
    expect(scopedRenderedFiles(graph, files, ['repo']).map(file => file.path)).toEqual([
      '.agents/skills/review/SKILL.md',
    ])
    expect(scopedRenderedFiles(graph, files, ['plugins']).map(file => file.path)).toEqual([
      'plugins/demo/agents/plugin.json',
      'plugins/README.md',
      'plugins/skillset.lock',
    ])
    expect(scopedOutputRoots(graph, ['repo'])).toEqual(['.agents/skills'])
    expect(scopedOutputRoots(graph, ['plugins'])).toEqual(['plugins'])
  })

  test('preserves standard root owners through sharing validation', () => {
    expect(() =>
      validateOutputRoots('/workspace', [], [
        { label: 'standards.agent-skills', path: '.agents/skills' },
        { label: 'outputs.skills.codex', path: '.agents/skills' },
      ])
    ).not.toThrow()
    expect(() =>
      validateOutputRoots('/workspace', [], [
        { label: 'standards.agent-plugins-1.0', path: 'plugins' },
        { label: 'outputs.plugins.claude', path: 'plugins' },
        { label: 'outputs.plugins.codex', path: 'plugins' },
      ])
    ).not.toThrow()
  })

  test('rejects non-Codex sharing of the Agent Skills root', () => {
    expect(() =>
      validateOutputRoots('/workspace', [], [
        { label: 'standards.agent-skills', path: '.agents/skills' },
        { label: 'outputs.skills.claude', path: '.agents/skills' },
      ])
    ).toThrow('outputs.skills.claude reuses output root .agents/skills')
    expect(() =>
      validateOutputRoots('/workspace', [], [
        { label: 'standards.agent-skills', path: '.agents/skills' },
        { label: 'outputs.skills.custom', path: '.agents/skills' },
      ])
    ).toThrow('outputs.skills.custom reuses output root .agents/skills')
  })

  test('keeps inherited non-adopted evidence out of production selection', () => {
    const plan = resolveStandardProjectionPlan(allStandards, allSource)

    expect(plan.adopted).toEqual([])
    expect(plan.explicitNonAdopted).toEqual([])
    expect(standardProjectionNonAdoptedDetail(plan)).toBeUndefined()
  })

  test('rejects an explicit current candidate selection', () => {
    const plan = resolveStandardProjectionPlan(allStandards, allSource, ['plugins'])

    expect(plan.adopted).toEqual([])
    expect(plan.explicitNonAdopted).toEqual(['agent-plugins-1.0'])
    expect(standardProjectionNonAdoptedDetail(plan)).toContain('agent-plugins-1.0')
  })

  test('rejects an explicitly selected retired profile but skips inherited retirement', () => {
    const profiles = retiredSkillsProfiles()
    const inherited = resolveStandardProjectionPlan(allStandards, allSource, [], profiles)
    const explicit = resolveStandardProjectionPlan(allStandards, allSource, ['skills'], profiles)

    expect(inherited.explicitNonAdopted).toEqual([])
    expect(explicit.explicitNonAdopted).toEqual(['agent-skills'])
    expect(standardProjectionNonAdoptedDetail(explicit)).toContain('not adopted')
  })

  test('converges to an adopted projection after registry promotion', () => {
    const plan = resolveStandardProjectionPlan(
      allStandards,
      allSource,
      ['plugins'],
      adoptedProfiles()
    )

    expect(plan).toEqual({
      adopted: ['agent-instructions', 'agent-plugins-1.0', 'agent-skills'],
      explicitNonAdopted: [],
    })
  })
})

function adoptedPlan() {
  return resolveStandardProjectionPlan(allStandards, allSource, [], adoptedProfiles())
}

function adoptedProfiles(): readonly StandardProfile[] {
  return listStandardProfiles().map(profile => ({
    ...profile,
    lifecycle: 'adopted' as const,
  }))
}

function retiredSkillsProfiles(): readonly StandardProfile[] {
  return listStandardProfiles().map(profile =>
    profile.id === 'agent-skills' ? { ...profile, lifecycle: 'retired' as const } : profile
  )
}

function graphForScope(standardProjections: BuildGraph['standardProjections']): BuildGraph {
  return {
    outputRoots: ['.agents/skills', 'plugins'],
    plugins: [{ id: 'demo' }],
    root: {
      outputs: {
        plugins: {
          claude: 'generated/claude/plugins',
          codex: 'generated/codex/plugins',
          cursor: 'generated/cursor/plugins',
        },
        skills: {
          claude: 'generated/claude/skills',
          codex: 'generated/codex/skills',
          cursor: 'generated/cursor/skills',
        },
      },
    },
    standardProjections,
  } as unknown as BuildGraph
}
