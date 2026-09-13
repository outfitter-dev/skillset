import { describe, expect, test } from 'bun:test'
import { listStandardProfiles, type StandardProfile } from '@skillset/registry'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  resolveCandidateStandardProjectionPlan,
  resolveStandardProjectionPlan,
  standardProjectionManagedOutputRoots,
  standardProjectionSourceInventory,
  standardProjectionTopology,
} from '../standard-projections'
import {
  buildSkillsetResult,
  diffSkillsetResult,
  scopedOutputRoots,
  scopedRenderedFiles,
  verifySkillsetResult,
} from '../build'
import { validateOutputRoots } from '../resolver'
import type { BuildGraph, RenderedFile, SourcePlugin, SourceRule, StandaloneSkill } from '../types'

const allSource = { instructions: 1, plugins: 1, skills: 1 }
const TEST_RECEIPT_HASH = `sha256:${'a'.repeat(64)}` as const

describe('standard projection resolution', () => {
  test('keeps source applicability independent from provider toggles', () => {
    const plan = resolveStandardProjectionPlan(allSource, adoptedProfiles())

    expect(plan).toEqual({
      adopted: ['agent-instructions', 'agent-plugins-1.0', 'agent-skills'],
      adoptionReceiptHashes: {
        'agent-instructions': TEST_RECEIPT_HASH,
        'agent-plugins-1.0': TEST_RECEIPT_HASH,
        'agent-skills': TEST_RECEIPT_HASH,
      },
    })
  })

  test('rejects providerless operations when scopes exclude every applicable standard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skillset-standard-projection-scope-'))
    try {
      await Bun.write(join(root, 'skillset.yaml'), [
        'skillset:',
        '  name: scope-only-standard',
        'compile:',
        '  targets: []',
        '',
      ].join('\n'))
      await Bun.write(join(root, '.skillset/skills/review/SKILL.md'), [
        '---',
        'name: review',
        'description: Review changes.',
        '---',
        '',
        'Review the change.',
        '',
      ].join('\n'))

      for (const operation of [
        () => buildSkillsetResult(root, { scopes: ['project'] }),
        () => diffSkillsetResult(root, { scopes: ['plugins'] }),
        () => verifySkillsetResult(root, { scopes: ['project'] }),
      ]) {
        await expect(operation()).rejects.toThrow('no eligible build projection is selected')
      }
      expect(await Bun.file(join(root, 'AGENTS.md')).exists()).toBe(false)
      expect(await Bun.file(join(root, '.agents/skills/skillset.lock')).exists()).toBe(false)
      expect(await Bun.file(join(root, 'plugins/skillset.lock')).exists()).toBe(false)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test.each([
    [{ instructions: 0, plugins: 1, skills: 1 }, ['agent-plugins-1.0', 'agent-skills']],
    [{ instructions: 1, plugins: 0, skills: 1 }, ['agent-instructions', 'agent-skills']],
    [
      { instructions: 1, plugins: 1, skills: 0 },
      ['agent-instructions', 'agent-plugins-1.0'],
    ],
    [{ instructions: 0, plugins: 0, skills: 0 }, []],
  ] as const)('derives only applicable standard families', (inventory, expected) => {
    expect(resolveStandardProjectionPlan(inventory, adoptedProfiles()).adopted).toEqual(expected)
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
      resolveStandardProjectionPlan(pluginOnly, adoptedProfiles()).adopted
    ).toEqual(['agent-plugins-1.0', 'agent-skills'])
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

  test('keeps candidate profiles out of production resolution', () => {
    const plan = resolveStandardProjectionPlan(allSource)

    expect(plan.adopted).toEqual([])
  })

  test('admits only applicable candidate profiles through the private conformance plan', () => {
    expect(
      resolveCandidateStandardProjectionPlan(allSource, 'agent-skills')
    ).toEqual({ adopted: ['agent-skills'], adoptionReceiptHashes: {} })

    expect(() =>
      resolveCandidateStandardProjectionPlan(
        { ...allSource, skills: 0 },
        'agent-skills'
      )
    ).toThrow('agent-skills has no applicable skills source')

    expect(() =>
      resolveCandidateStandardProjectionPlan(
        allSource,
        'agent-skills',
        adoptedProfiles()
      )
    ).toThrow('agent-skills is adopted')
  })

  test('keeps retired profiles out of production resolution', () => {
    expect(resolveStandardProjectionPlan(allSource, retiredSkillsProfiles()).adopted).toEqual([
      'agent-instructions',
      'agent-plugins-1.0',
    ])
  })

  test('converges to an adopted projection after registry promotion', () => {
    const plan = resolveStandardProjectionPlan(allSource, adoptedProfiles())

    expect(plan).toEqual({
      adopted: ['agent-instructions', 'agent-plugins-1.0', 'agent-skills'],
      adoptionReceiptHashes: {
        'agent-instructions': TEST_RECEIPT_HASH,
        'agent-plugins-1.0': TEST_RECEIPT_HASH,
        'agent-skills': TEST_RECEIPT_HASH,
      },
    })
  })
})

function adoptedPlan() {
  return resolveStandardProjectionPlan(allSource, adoptedProfiles())
}

function adoptedProfiles(): readonly StandardProfile[] {
  return listStandardProfiles().map(profile => ({
    ...profile,
    adoption: {
      profileContentHash: profile.provenance.contentHash as `sha256:${string}`,
      receipt: {
        contentHash: TEST_RECEIPT_HASH,
        path: `fixtures/standards/evidence/${profile.id}.json`,
        schema: 'skillset.standards-conformance-receipt@1' as const,
      },
      rendererCommit: 'a'.repeat(40),
      schema: 'skillset-standard-profile-adoption@1' as const,
      verifiedAt: '2026-09-13T00:00:00.000Z',
    },
    lifecycle: 'adopted' as const,
  }))
}

function retiredSkillsProfiles(): readonly StandardProfile[] {
  return adoptedProfiles().map(profile => {
    if (profile.id !== 'agent-skills') return profile
    const { adoption: _adoption, ...candidate } = profile
    return { ...candidate, lifecycle: 'retired' as const }
  })
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
