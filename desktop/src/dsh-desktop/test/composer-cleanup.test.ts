import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

describe('composer cleanup (Grok-simple layout)', () => {
  it('moves the model dropdown and access shield out of the composer card', async () => {
    const client = await readFile(
      path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'),
      'utf8',
    )
    const chrome = client.indexOf('data-composer-chrome')
    const card = client.indexOf('"data-composer-card": true')
    const modelInChrome = client.indexOf('renderSlot("conversation.input.model"', chrome)
    const modelAfterCard = client.indexOf('renderSlot("conversation.input.model"', card)
    const trailing = client.indexOf('InputBar_module_css_default.trailing', card)
    expect(chrome).toBeGreaterThan(-1)
    expect(card).toBeGreaterThan(chrome)
    expect(modelInChrome).toBeGreaterThan(chrome)
    expect(modelInChrome).toBeLessThan(card)
    expect(modelAfterCard).toBe(-1)
    expect(client).toContain('InputBar_module_css_default.chrome')
    expect(client).toContain('accessSelect')
    // Access + plan stay in the chrome row, not the in-card tool cluster.
    const modesAfterCard = client.indexOf('InputBar_module_css_default.modes', card)
    expect(modesAfterCard).toBe(-1)
    expect(trailing).toBeGreaterThan(card)
    expect(client.slice(card, card + 8000)).not.toContain('ContextMeter')
  })

  it('keeps mic on the right next to send and attach as a single +', async () => {
    const voice = await readFile(path.join(projectRoot, 'packages/abaco-voice/client.js'), 'utf8')
    const docs = await readFile(path.join(projectRoot, 'packages/abaco-documents/client.js'), 'utf8')
    expect(voice).toContain("name: 'conversation.input.right'")
    expect(voice).toContain("id: 'abaco-voice-mic'")
    expect(voice).toContain('abaco-mic-chip-sr')
    expect(voice).toContain('Mic del Mac')
    expect(docs).toContain("name: 'conversation.input.left'")
    expect(docs).toContain("data-abaco-attach': 'unified'")
  })
})
