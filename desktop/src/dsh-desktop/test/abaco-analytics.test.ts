import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { apply as applyAnalytics } from '../packages/abaco-analytics/index.js'
import { patchPath, projectRoot } from './patch-path'
import {
  formatDuration,
  formatPercent,
  formatTokens,
  isAnalyticsStripText,
  summarizeChatNodes,
} from '../packages/abaco-analytics/lib/summary.js'

const ANALYTICS_STRIP =
  '18 turns · 163 steps | LLM 27m6s · Tool call 42m23s | TTFT avg 4.7 | Cache hit 95% | Input 22.8M tok'

const SUMMARY_FIXTURE = [
  {
    kind: 'assistant',
    turn: 2,
    step: 5,
    timing: { stepStartTime: 0, firstTokenTime: 400, completedTime: 1400 },
    usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 80, completion_tokens: 20 },
  },
  {
    kind: 'assistant',
    turn: 3,
    step: 8,
    timing: { stepStartTime: 2000, firstTokenTime: 2600, completedTime: 3600 },
    usage: { inputTokens: 50, cacheReadTokens: 10, outputTokens: 15 },
  },
  { kind: 'user', turn: 3 },
]

function loadAnalyticsClientFactory() {
  return readFile(path.join(projectRoot, 'packages/abaco-analytics/client.js'), 'utf8').then((source) => {
    const recorded: string[] = []
    const warnings: string[] = []
    const sandbox: {
      window: {
        __ModuleLoader__: {
          load: (entry: { factory: (require: (id: string) => unknown) => unknown }) => void
        }
      }
      console: Pick<Console, 'warn'>
      exports?: {
        apply: (ctx: unknown) => void
        __test__: {
          summarizeChatNodes: typeof summarizeChatNodes
          isAnalyticsStripText: typeof isAnalyticsStripText
          formatDuration: typeof formatDuration
          formatTokens: typeof formatTokens
          formatPercent: typeof formatPercent
        }
      }
    } = {
      Object,
      Array,
      Number,
      Math,
      Set,
      Date,
      String,
      Boolean,
      JSON,
      Error,
      Symbol,
      Map,
      RegExp,
      window: {
        __ModuleLoader__: {
          load(entry) {
            sandbox.exports = entry.factory((id) => {
              recorded.push(id)
              if (id === 'react') {
                return {
                  createElement: () => null,
                  useEffect: () => {},
                  useState: (value: unknown) => [value, () => {}],
                }
              }
              throw new Error(
                `client-modules: require(${JSON.stringify(id)}) missed the module table – not a platform seed word, not a materialized module, and no registered package factory (a build-time external's drift, or a dynamic dependency that did not arrive)`,
              )
            }) as typeof sandbox.exports
          },
        },
      },
      console: {
        warn: (message?: unknown) => {
          warnings.push(String(message))
        },
      },
    }
    runInContext(source, createContext(sandbox))
    return { exports: sandbox.exports, recorded, warnings }
  })
}

describe('abaco-analytics summary', () => {
  it('detects the composer analytics strip and ignores short chrome', () => {
    expect(isAnalyticsStripText(
      '18 turns · 163 steps | LLM 27m6s · Tool call 42m23s | TTFT avg 4.7 | Cache hit 95% | Input 22.8M tok',
    )).toBe(true)
    expect(isAnalyticsStripText('Usage 594K tok')).toBe(false)
    expect(isAnalyticsStripText('Ran for 25s')).toBe(false)
    expect(isAnalyticsStripText('')).toBe(false)
  })

  it('rolls assistant nodes into turns/steps/LLM/TTFT/cache/input', () => {
    const summary = summarizeChatNodes([
      {
        kind: 'assistant',
        turn: 2,
        step: 5,
        timing: { stepStartTime: 0, firstTokenTime: 400, completedTime: 1400 },
        usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 80, completion_tokens: 20 },
      },
      {
        kind: 'assistant',
        turn: 3,
        step: 8,
        timing: { stepStartTime: 2000, firstTokenTime: 2600, completedTime: 3600 },
        usage: { inputTokens: 50, cacheReadTokens: 10, outputTokens: 15 },
      },
      { kind: 'user', turn: 3 },
    ])
    expect(summary.turns).toBe(3)
    expect(summary.steps).toBe(8)
    expect(summary.requestCount).toBe(2)
    expect(summary.llmMs).toBe(2000)
    expect(summary.ttftAvgMs).toBe(500)
    expect(summary.inputTokens).toBe(150)
    expect(summary.cachedTokens).toBe(90)
    expect(summary.cacheHitRate).toBeCloseTo(90 / 240)
    expect(formatDuration(27 * 60 * 1000 + 6000)).toBe('27m6s')
    expect(formatTokens(22_800_000)).toBe('22.8M tok')
    expect(formatPercent(0.95)).toBe('95%')
  })
})

describe('abaco-analytics plugin wiring', () => {
  it('registers Settings → Analytics and hides the composer strip', async () => {
    const client = await readFile(path.join(projectRoot, 'packages/abaco-analytics/client.js'), 'utf8')
    const host = await readFile(path.join(projectRoot, 'packages/abaco-analytics/index.js'), 'utf8')
    expect(host).toContain("export const name = 'abaco-analytics'")
    expect(client).toContain("name: 'settings.section'")
    expect(client).toContain("id: SETTINGS_ID")
    expect(client).toContain("label: 'Analytics'")
    expect(client).toContain('data-abaco-analytics')
    expect(client).toContain('data-abaco-hidden-analytics')
    expect(client).toContain('isAnalyticsStripText')
    expect(client).toContain("name: 'conversation.session.header.utilities'")
  })

  it('does not relative-require off the client module table', async () => {
    const client = await readFile(path.join(projectRoot, 'packages/abaco-analytics/client.js'), 'utf8')
    const executable = client
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(executable).not.toMatch(/require\(\s*['"]\.\.?[\\/]/)
    const loaded = await loadAnalyticsClientFactory()
    expect(loaded.recorded).toEqual(['react'])
    expect(loaded.exports?.__test__.isAnalyticsStripText(ANALYTICS_STRIP)).toBe(true)
    expect(loaded.exports?.__test__.summarizeChatNodes(SUMMARY_FIXTURE)).toEqual(
      summarizeChatNodes(SUMMARY_FIXTURE),
    )
  })

  it('host apply() degrades and never throws', () => {
    expect(() => applyAnalytics(null)).not.toThrow()
    expect(() => applyAnalytics({ logger: { warn: () => { throw new Error('log boom') } } })).not.toThrow()
  })

  it('client apply() degrades a slot throw instead of failing the loader', async () => {
    const loaded = await loadAnalyticsClientFactory()
    expect(() =>
      loaded.exports?.apply({
        slots: {
          inject: () => {
            throw new Error('Invalid effect')
          },
        },
      }),
    ).not.toThrow()
    expect(loaded.warnings.some((line) => line.includes('Settings → Analytics is off'))).toBe(true)
  })

  it('is mounted through the three plugin-safe sites', async () => {
    const patch = await readFile(path.join(projectRoot, 'build/dsh-desktop.patch.yml'), 'utf8')
    const dsh = await readFile(patchPath('@deepseek-ai/dsh'), 'utf8')
    const manifest = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    expect(patch).toContain('id: abaco-analytics')
    expect(patch).toContain("name: abaco-analytics")
    expect(dsh).toContain('+    "abaco-analytics": "0.1.0"')
    expect(manifest.dependencies['abaco-analytics']).toBe('file:packages/abaco-analytics')
    expect(patch).not.toMatch(/id: abaco-brand\n  disabled: false/u)
    expect(patch).toContain('abaco-brand, abaco-device-identity, abaco-cloud-sync, abaco-onboarding')
  })
})
