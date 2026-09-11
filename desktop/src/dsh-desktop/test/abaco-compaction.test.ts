import { describe, expect, it } from 'vitest'
import {
  apply,
  applyConsentOutcome,
  COMPACTION_APPROVAL_TOOL,
  inject,
  name,
  wrapEngine
} from '../packages/abaco-context/compaction.js'
import {
  applyConsentOutcome as applyOutcome,
  guardedCompactIfNeeded,
  nextConsentAction,
  normalizeConsent,
  probeCrossing,
  REJECT_SOFT_WARN
} from '../packages/abaco-context/lib/consent.js'
import { extractLiteralErrors, formatLiteralError, prependLiteralErrors } from '../packages/abaco-context/lib/literal-errors.js'
import {
  ABACO_COMPACTION_LOCK,
  assertLockPolicy,
  DEAD_POLICIES,
  lockAlerts,
  matchesLock,
  RETAIN_RATIO,
  THRESHOLD_RATIO
} from '../packages/abaco-context/lib/lock.js'
import { isProtectedErrorResult, pruneSessionGuarded } from '../packages/abaco-context/lib/pruner-guard.js'

/**
 * Principle C + Principle D + the 0.90/0.12 lock.
 *
 * These tests drive the shipped wrappers, not a re-implementation: the consent
 * machine, the isError pruner guard and the literal-error summarizer are the
 * same functions the isolate-group plugin installs. `apply` must stay
 * synchronous and return nothing — an object or a promise is `Invalid effect`.
 */

describe('abaco-compaction lock', () => {
  it('locks 0.90 / 0.12 / 8192 forever, ratios only', () => {
    expect(ABACO_COMPACTION_LOCK).toEqual({
      thresholdRatio: 0.9,
      retainRatio: 0.12,
      maxTokens: 8192,
      auto: true
    })
    expect(RETAIN_RATIO).toBeLessThan(THRESHOLD_RATIO)
    assertLockPolicy(ABACO_COMPACTION_LOCK)
    expect(matchesLock({ thresholdRatio: 0.9, retainRatio: 0.12, maxTokens: 8192 })).toBe(true)
    expect(matchesLock({ ...DEAD_POLICIES.stock, maxTokens: 8192 })).toBe(false)
    expect(matchesLock({ ...DEAD_POLICIES.discardedPreset })).toBe(false)
    expect(lockAlerts({ thresholdRatio: 0.8, retainRatio: 0.16, retainTokens: 160000 })).toEqual(
      expect.arrayContaining(['policy-lock-threshold', 'policy-lock-retain', 'policy-lock-retain-tokens'])
    )
    expect(() => assertLockPolicy({ thresholdRatio: 0.8, retainRatio: 0.12 })).toThrow(/policy-lock-threshold/)
  })
})

describe('abaco-compaction Principle C', () => {
  it('asks on the first crossing, then is automatic; reject does not loop', () => {
    const unset = normalizeConsent(undefined)
    expect(nextConsentAction(unset, { wouldCompact: true })).toMatchObject({ action: 'ask' })
    expect(nextConsentAction(unset, { wouldCompact: false })).toMatchObject({ action: 'skip' })
    expect(nextConsentAction(unset, { unknown: true })).toMatchObject({ action: 'pass' })

    const allowed = applyConsentOutcome(unset, 'allowed-once')
    expect(allowed).toEqual({ state: 'allowed', armed: true })
    expect(nextConsentAction(allowed, { wouldCompact: true })).toMatchObject({ action: 'allow' })

    const rejected = applyConsentOutcome(unset, 'rejected')
    expect(rejected).toEqual({ state: 'rejected', armed: false })
    const loop = nextConsentAction(rejected, { wouldCompact: true })
    expect(loop).toMatchObject({ action: 'skip', warn: true })
    expect(loop.next).toEqual({ state: 'rejected', armed: false })

    const dropped = nextConsentAction(rejected, { wouldCompact: false })
    expect(dropped).toMatchObject({ action: 'skip', warn: false })
    expect(dropped.next).toEqual({ state: 'rejected', armed: true })
    expect(nextConsentAction(dropped.next, { wouldCompact: true })).toMatchObject({ action: 'ask' })

    expect(applyOutcome(unset, 'cancelled').state).toBe('rejected')
    expect(applyOutcome(unset, 'unavailable').state).toBe('rejected')
    expect(REJECT_SOFT_WARN).toContain('0.90')
  })

  it('does not compact on reject, persists on accept, and does not re-ask', async () => {
    const asks: unknown[] = []
    const writes: unknown[] = []
    const persists: unknown[] = []
    const warns: string[] = []
    let consent = { state: 'unset' as const, armed: true }
    const hooks = {
      probe: async () => ({ wouldCompact: true, used: 900, thresholdTokens: 900, retainTokens: 120 }),
      ask: async () => {
        asks.push('ask')
        return asks.length === 1 ? 'rejected' : 'allowed-once'
      },
      readConsent: async () => consent,
      writeConsent: async (_agent: unknown, next: { state: string; armed: boolean }) => {
        writes.push(next)
        consent = next as typeof consent
        return next
      },
      persistBeforeCompact: async () => {
        persists.push('flush')
      },
      warn: (message: string) => warns.push(message)
    }

    const compact = async () => ({ id: 'checkpoint-1' })

    expect(await guardedCompactIfNeeded({ compact, agent: { session: { header: { id: 's' } } }, trigger: 'pressure', signal: undefined, hooks })).toBeNull()
    expect(asks).toHaveLength(1)
    expect(persists).toHaveLength(0)
    expect(writes.at(-1)).toEqual({ state: 'rejected', armed: false })
    expect(warns.some((line) => line.includes('declined'))).toBe(true)

    expect(await guardedCompactIfNeeded({ compact, agent: { session: { header: { id: 's' } } }, trigger: 'pressure', signal: undefined, hooks })).toBeNull()
    expect(asks).toHaveLength(1)

    consent = { state: 'rejected', armed: true }
    const accepted = await guardedCompactIfNeeded({
      compact,
      agent: { session: { header: { id: 's' } } },
      trigger: 'pressure',
      signal: undefined,
      hooks
    })
    expect(accepted).toEqual({ id: 'checkpoint-1' })
    expect(asks).toHaveLength(2)
    expect(persists).toHaveLength(1)
    expect(writes.at(-1)).toEqual({ state: 'allowed', armed: true })

    const second = await guardedCompactIfNeeded({
      compact,
      agent: { session: { header: { id: 's' } } },
      trigger: 'pressure',
      signal: undefined,
      hooks
    })
    expect(second).toEqual({ id: 'checkpoint-1' })
    expect(asks).toHaveLength(2)
    expect(persists).toHaveLength(2)
  })

  it('treats overflow as a crossing and an unknown meter as a pass', () => {
    const engine = {
      config: ABACO_COMPACTION_LOCK,
      ctx: { tokenMeter: { measure: () => ({ totalTokens: 100, contextWindow: 1000 }) } }
    }
    expect(probeCrossing(engine, {}, 'context-overflow').wouldCompact).toBe(true)
    expect(probeCrossing({ config: ABACO_COMPACTION_LOCK, ctx: {} }, {}, 'pressure').unknown).toBe(true)
  })
})

describe('abaco-compaction Principle D', () => {
  it('skips pruneContent when isError is true, and prunes the twin', () => {
    const marker = 'UNIQUE_MARKER_AT_8500'
    const body = `${'x'.repeat(8500)}${marker}`
    const calls: Array<{ isError: boolean; content: unknown }> = []
    const appends: Array<{ type: string; data: unknown }> = []
    const pruner = {
      pruneContent: (content: unknown) => {
        calls.push({ isError: false, content })
        return [{ type: 'text', text: 'pruned' }]
      },
      measureContent: (content: unknown) => {
        const text = Array.isArray(content) ? content.map((block: { text?: string }) => block.text ?? '').join('') : ''
        return text.length
      }
    }
    const errorEvent = {
      type: 'tool/result',
      data: {
        message: {
          content: [{ isError: true, name: 'bash', content: [{ type: 'text', text: body }] }]
        }
      }
    }
    const okEvent = {
      type: 'tool/result',
      data: {
        message: {
          content: [{ isError: false, name: 'bash', content: [{ type: 'text', text: body }] }]
        }
      }
    }
    const session = {
      surface: { nodes: [10, 20] },
      eventAt: (seq: number) => (seq === 10 ? errorEvent : okEvent),
      append: (type: string, data: unknown) => {
        appends.push({ type, data })
        return { seq: 100 + appends.length }
      }
    }

    expect(isProtectedErrorResult(errorEvent.data.message.content[0])).toBe(true)
    const outcome = pruneSessionGuarded(pruner, session)
    expect(outcome.skippedErrors).toBe(1)
    expect(outcome.pruned).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(appends)).not.toContain(marker)
    expect(errorEvent.data.message.content[0].content[0].text).toContain(marker)
  })

  it('pulls errors out of the corpus as ERROR | tool | raw', () => {
    const input = {
      messages: [
        {
          content: [
            {
              type: 'tool-result',
              name: 'bash',
              isError: true,
              content: [{ type: 'text', text: 'ENOENT: no such file /tmp/x' }]
            }
          ]
        },
        { content: [{ type: 'text', text: 'ok turn' }] }
      ]
    }
    const { input: cleaned, literals } = extractLiteralErrors(input)
    expect(literals).toEqual([formatLiteralError('bash', 'ENOENT: no such file /tmp/x')])
    expect(literals[0]).toBe('ERROR | bash | ENOENT: no such file /tmp/x')
    expect(cleaned.messages).toHaveLength(1)
    const prepended = prependLiteralErrors({ summary: [{ type: 'text', text: 'how it was resolved' }] }, literals)
    expect(prepended.summary[0].text).toContain('## Errors and Fixes (literal)')
    expect(prepended.summary[0].text).toContain('ERROR | bash | ENOENT: no such file /tmp/x')
    expect(prepended.summary[0].text).toContain('how it was resolved')
  })
})

describe('abaco-compaction plugin surface', () => {
  it('is a synchronous wrap that returns nothing', () => {
    expect(name).toBe('abaco-compaction')
    expect(inject).toEqual(['compaction', 'toolResultPruner'])
    expect(COMPACTION_APPROVAL_TOOL).toBe('abaco_compact')
    const pruner = {
      pruneSession: () => ({ pruned: [] }),
      pruneContent: () => null,
      measureContent: () => 0
    }
    const originalCompact = async () => null
    const engine = {
      compactIfNeeded: originalCompact,
      summarize: async () => ({ summary: [] }),
      config: ABACO_COMPACTION_LOCK
    }
    const returned = apply({ compaction: engine, toolResultPruner: pruner })
    expect(returned).toBeUndefined()
    expect(typeof pruner.pruneSession).toBe('function')
    expect(engine.compactIfNeeded).not.toBe(originalCompact)
    const wrapped = wrapEngine({ compactIfNeeded: originalCompact, summarize: async () => ({ summary: [] }) }, {})
    expect(wrapped.compactIfNeeded).not.toBe(originalCompact)
  })
})
