import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { patchPath, projectRoot } from './patch-path'
import {
  formatDuration,
  formatPercent,
  formatTokens,
  isAnalyticsStripText,
  summarizeChatNodes,
} from '../packages/abaco-analytics/lib/summary.js'

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
