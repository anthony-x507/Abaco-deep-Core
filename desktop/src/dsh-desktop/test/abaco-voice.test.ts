import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * P0 voice contract against the live client bundle (8069195):
 * web-speech is live SpeechRecognition; after STT the mic setDrafts then submit/send.
 */

const here = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(join(here, '../packages/abaco-voice/client.js'), 'utf8')

describe('abaco-voice speak-to-send', () => {
  it('writes the transcript then calls submit or send', () => {
    expect(clientSource).toContain('function resolveSetDraft(props)')
    expect(clientSource).toMatch(/const trimmed = String\(text \|\| ''\)\.trim\(\)/)
    expect(clientSource).toMatch(/if \(!trimmed\) return/)
    expect(clientSource).toContain('resolved.setDraft(next)')
    expect(clientSource).toMatch(/typeof actions\.submit === 'function'/)
    expect(clientSource).toContain('actions.submit()')
    expect(clientSource).toMatch(/typeof actions\.send === 'function'/)
    expect(clientSource).toContain('actions.send()')
  })

  it('uses live SpeechRecognition for web-speech-stt (not MediaRecorder→blob)', () => {
    expect(clientSource).toMatch(/live:\s*true/)
    expect(clientSource).toContain('createRecognizer')
    expect(clientSource).toContain('isLiveSttProvider')
    expect(clientSource).toMatch(/web-speech-stt es live-only/)
  })
})
